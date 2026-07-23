import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  GUEST_COOKIE,
  GUEST_COOKIE_MAX_AGE,
  createGuestSessionToken,
  verifyEmailVerifyToken,
} from "@/lib/guestAuth";
import { getPortalConfig } from "@/lib/config";
import { authorizeGuest, guestClientNote } from "@/lib/unifi";
import { isRegistrationActive, latestPerMac } from "@/lib/guestDevices";
import { planForLocationId } from "@/lib/locations";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * The guest clicked the button on /portal/verify. The token proves they can
 * read the mailbox, so: mark the email verified, upgrade every active device
 * from its provisional window to the configured full duration, and sign them
 * into self-service.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(`verify-confirm:${clientIp(req) ?? "unknown"}`, 10, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many attempts — try again later" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = await verifyEmailVerifyToken(typeof body.token === "string" ? body.token : null);
  if (!parsed) {
    return NextResponse.json({ error: "This link is invalid or has expired" }, { status: 400 });
  }
  const { phone, email } = parsed;

  const rows = await prisma.guestRegistration.findMany({
    where: {
      phone,
      email: { equals: email, mode: "insensitive" },
      anonymizedAt: null,
    },
    orderBy: { authorizedAt: "desc" },
  });
  if (rows.length === 0) {
    return NextResponse.json({ error: "This link is no longer valid" }, { status: 400 });
  }

  const cfg = await getPortalConfig();
  const now = new Date();

  await prisma.guestRegistration.updateMany({
    where: { phone, email: { equals: email, mode: "insensitive" }, emailVerifiedAt: null },
    data: { emailVerifiedAt: now },
  });

  // Upgrade currently-active devices from their provisional window to the
  // full configured duration; expired ones simply register again as verified.
  const activeDevices = latestPerMac(rows.filter((r) => !r.revokedAt)).filter((r) =>
    isRegistrationActive(r),
  );
  const upgraded: string[] = [];
  for (const device of activeDevices) {
    try {
      // Tiered plan: upgrade each device to ITS location's full duration.
      const plan = await planForLocationId(cfg, device.locationId);
      await authorizeGuest({
        mac: device.macAddress,
        minutes: plan.durationMin,
        downKbps: plan.downKbps,
        upKbps: plan.upKbps,
        bytesQuotaMB: plan.quotaMB,
        apMac: device.apMac,
        note: guestClientNote(device.firstName, device.lastName, device.phone),
      });
      await prisma.guestRegistration.update({
        where: { id: device.id },
        data: { durationMin: plan.durationMin },
      });
      upgraded.push(device.macAddress);
    } catch (err) {
      // Verification still stands; the device keeps its provisional window
      // and gets the full duration on its next (now-verified) registration.
      console.error(`Post-verify upgrade failed for ${device.macAddress}:`, err);
    }
  }

  audit(req, {
    actorType: "guest",
    actor: phone,
    action: "guest.email_verified",
    target: email,
    detail: { upgradedDevices: upgraded },
  });

  const res = NextResponse.json({ ok: true, upgraded: upgraded.length });
  res.cookies.set(GUEST_COOKIE, await createGuestSessionToken(phone), {
    httpOnly: true,
    sameSite: "lax",
    secure: cfg.cookieSecure,
    path: "/",
    maxAge: GUEST_COOKIE_MAX_AGE,
  });
  return res;
}
