import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { authorizeGuest, guestClientNote } from "./unifi";
import { onlyDigits, type GuestRegistrationInput } from "./validators";
import { getPortalConfig } from "./config";
import { createMagicLinkToken, createEmailVerifyToken } from "./guestAuth";
import { canonicalizeMac } from "./mac";
import { isRegistrationActive, latestPerMac } from "./guestDevices";
import { planFor, resolveLocationForRegistration } from "./locations";
import { eventOverride, getActiveEvent } from "./events";
import { getMailSettings, isEmailVerificationActive, sendVerificationEmail } from "./mailer";
import { getSystemSettings } from "./settings";
import type { GuestRegistration } from "@prisma/client";

/**
 * The registration core, shared by the captive form's authorize route and
 * the sponsored-access approval path: resolve location/plan/voucher/verify,
 * write the GuestRegistration row atomically (device cap, MAC ownership
 * transfer, voucher claim), authorize the MAC on the controller, and send
 * the verification email when one is due. Throws RegistrationError with an
 * HTTP status for every expected failure; the controller-rejection path
 * deletes the row first so a failed grant leaves nothing behind.
 */

export class RegistrationError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type RegisterGuestResult = {
  id: number;
  redirect: string | null;
  magicToken: string;
  verifyPending: boolean;
  grantedMin: number;
  phone: string;
  mac: string;
  locationId: number | null;
  locationName: string | null;
  ssid: string | null;
  voucherId: number | null;
};

export async function registerGuest(
  data: GuestRegistrationInput,
  ctx: { userAgent?: string; ipAddress?: string; origin: string },
  opts: {
    /** Sponsor-approved requests carry the sponsor's grant: it overrides the
     * plan duration and stands in for email verification, like a voucher. */
    minutesOverride?: number;
  } = {},
): Promise<RegisterGuestResult> {
  // Canonicalize to the lowercase colon-separated form the device-management
  // routes and UniFi use, so rows written here match lookups made there.
  const mac = canonicalizeMac(data.mac);
  if (!mac) throw new RegistrationError("Invalid MAC address", 400);
  const apMac = data.apMac ? canonicalizeMac(data.apMac) : null;
  const phone = onlyDigits(data.phone);

  const { location, error: locationError } = await resolveLocationForRegistration(
    data.locationId,
    data.building,
    data.roomNumber,
  );
  if (locationError) throw new RegistrationError(locationError, 400);

  const cfg = await getPortalConfig();
  // Consent record: fingerprint the terms text the guest is accepting, so a
  // later terms change doesn't orphan the question "what did they agree to".
  const consentTermsHash = createHash("sha256")
    .update((await getSystemSettings()).termsOfUse)
    .digest("hex")
    .slice(0, 12);
  // Tiered plan: the chosen location can override the site-wide defaults; an
  // active event overrides again (below a voucher). Precedence:
  // voucher > event > location > site default.
  const activeEvent = await getActiveEvent();
  const plan = planFor(cfg, location, eventOverride(activeEvent));

  // Voucher redemption: a valid code overrides duration/bandwidth/quota and
  // stands in for email verification (the code itself is the authorization).
  const voucherCode = data.voucher ? data.voucher.toUpperCase().replace(/[^A-Z0-9]/g, "") : null;
  let voucher: Awaited<ReturnType<typeof prisma.voucher.findUnique>> = null;
  if (voucherCode) {
    voucher = await prisma.voucher.findUnique({ where: { code: voucherCode } });
    if (!voucher || voucher.revokedAt) throw new RegistrationError("Invalid voucher code", 400);
    if (voucher.expiresAt && voucher.expiresAt.getTime() <= Date.now()) {
      throw new RegistrationError("This voucher has expired", 400);
    }
    if (voucher.maxUses > 0 && voucher.usedCount >= voucher.maxUses) {
      throw new RegistrationError("This voucher has already been used", 400);
    }
  }

  // Email verification: unverified guests get a short provisional window
  // (initial on first registration, grace on later ones) and an emailed
  // confirmation link that upgrades them to the full duration. A sponsor
  // grant (minutesOverride) pre-clears verification like a voucher does.
  const mail = await getMailSettings();
  const sponsored = opts.minutesOverride !== undefined;
  const verifyActive = isEmailVerificationActive(mail) && !voucher && !sponsored;
  const email = data.email?.trim().toLowerCase() || null;
  let verifyPending = false;
  let minutes = sponsored ? opts.minutesOverride! : voucher ? voucher.durationMin : plan.durationMin;
  let emailVerifiedAt: Date | null = voucher || sponsored ? new Date() : null;

  if (verifyActive) {
    if (!email) throw new RegistrationError("An email address is required", 400);
    const priorSameEmail = await prisma.guestRegistration.findFirst({
      where: { phone, email: { equals: email, mode: "insensitive" }, anonymizedAt: null },
      orderBy: { authorizedAt: "desc" },
      select: { emailVerifiedAt: true },
    });
    const alreadyVerified = await prisma.guestRegistration.findFirst({
      where: {
        phone,
        email: { equals: email, mode: "insensitive" },
        emailVerifiedAt: { not: null },
      },
      select: { emailVerifiedAt: true },
    });
    if (alreadyVerified) {
      emailVerifiedAt = alreadyVerified.emailVerifiedAt;
    } else {
      verifyPending = true;
      minutes = priorSameEmail ? mail.emailVerifyGraceMin : mail.emailVerifyInitialMin;
    }
  }

  const downKbps = voucher?.downKbps ?? plan.downKbps;
  const upKbps   = voucher?.upKbps   ?? plan.upKbps;
  const quotaMB  = voucher?.quotaMB  ?? plan.quotaMB;

  const created: GuestRegistration = await prisma.$transaction(async (tx) => {
      // Serialize with /api/portal/devices adds for this phone so the cap
      // check + insert is atomic.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${phone}))`;

      const rows = await tx.guestRegistration.findMany({
        where: { phone, revokedAt: null },
        orderBy: { authorizedAt: "desc" },
      });
      const activeOtherMacs = latestPerMac(rows).filter(
        (r) => r.macAddress !== mac && isRegistrationActive(r),
      );
      if (activeOtherMacs.length >= plan.maxDevices) {
        throw new RegistrationError(
          `Device limit reached (max ${plan.maxDevices}). Log in via "Manage your devices" to remove one first.`,
          400,
        );
      }

      // The registrant physically holds this device, so any earlier claim on
      // the MAC by a different phone is stale — transfer ownership rather
      // than leaving two phones able to list/revoke the same device.
      await tx.guestRegistration.updateMany({
        where: { macAddress: mac, phone: { not: phone }, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Claim the voucher use atomically — two devices racing for the last
      // use of a code must not both win.
      if (voucher) {
        const claimed = await tx.voucher.updateMany({
          where: {
            id: voucher.id,
            revokedAt: null,
            ...(voucher.maxUses > 0 ? { usedCount: { lt: voucher.maxUses } } : {}),
          },
          data: { usedCount: { increment: 1 } },
        });
        if (claimed.count !== 1) {
          throw new RegistrationError("This voucher has already been used", 400);
        }
      }

      return tx.guestRegistration.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          phone,
          email,
          emailVerifiedAt,
          macAddress: mac,
          apMac,
          ssid: data.ssid ?? null,
          site: data.site ?? null,
          userAgent: ctx.userAgent,
          ipAddress: ctx.ipAddress,
          // locationType now carries the location name so pre-Locations CSV/
          // log consumers keep showing something meaningful.
          locationType: location?.name ?? "none",
          locationId: location?.id ?? null,
          locationName: location?.name ?? null,
          building: data.building?.trim() || null,
          roomNumber: data.roomNumber?.trim() || null,
          durationMin: minutes,
          consentTermsHash,
          downKbps,
          upKbps,
          voucherId: voucher?.id ?? null,
          eventId: activeEvent?.id ?? null,
        },
      });
  });

  try {
    await authorizeGuest({
      mac,
      minutes,
      downKbps,
      upKbps,
      bytesQuotaMB: quotaMB,
      apMac,
      note: guestClientNote(data.firstName, data.lastName, phone),
    });
  } catch (err) {
    await prisma.guestRegistration.delete({ where: { id: created.id } }).catch(() => {});
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new RegistrationError(`Could not grant access: ${message}`, 502);
  }

  if (verifyActive && verifyPending && email) {
    const base = mail.guestBaseUrl || mail.portalBaseUrl || ctx.origin;
    const token = await createEmailVerifyToken(phone, email);
    sendVerificationEmail(mail, {
      to: email,
      firstName: data.firstName,
      verifyUrl: `${base.replace(/\/$/, "")}/portal/verify?token=${encodeURIComponent(token)}`,
    });
  }

  const magicToken = await createMagicLinkToken(phone);

  return {
    id: created.id,
    redirect: cfg.portalSuccessUrl || data.originalUrl || null,
    magicToken,
    verifyPending,
    grantedMin: minutes,
    phone,
    mac,
    locationId: location?.id ?? null,
    locationName: location?.name ?? null,
    ssid: data.ssid ?? null,
    voucherId: voucher?.id ?? null,
  };
}
