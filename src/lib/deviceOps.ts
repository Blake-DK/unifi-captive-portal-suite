import { prisma } from "./prisma";
import { authorizeGuest, unauthorizeGuest, guestClientNote } from "./unifi";
import { getPortalConfig } from "./config";
import { isRegistrationActive, latestPerMac } from "./guestDevices";
import { getMailSettings, isEmailVerificationActive } from "./mailer";
import { planForLocationId } from "./locations";
import type { GuestRegistration } from "@prisma/client";

/**
 * True when email verification is enforced and this row's guest still hasn't
 * confirmed. Rows without an email (pre-feature or feature-off registrations)
 * are not treated as pending — they never had a link to click.
 */
function isVerifyPending(row: Pick<GuestRegistration, "email" | "emailVerifiedAt">): boolean {
  return !!row.email && !row.emailVerifiedAt;
}

/**
 * Shared by guest self-service and admin-on-behalf-of-guest device
 * operations, so both surfaces stay behaviourally identical (same cap
 * enforcement, same cross-phone dup guard, same UniFi-failure rollback).
 */
export class DeviceOpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type AddDeviceOptions = {
  label?: string | null;
  userAgent?: string;
  ipAddress?: string;
};

export async function addDeviceForPhone(
  phone: string,
  mac: string,
  opts: AddDeviceOptions = {},
): Promise<GuestRegistration> {
  const cfg = await getPortalConfig();
  // Tiered plan of the guest's location (from their latest registration).
  const planRow = await prisma.guestRegistration.findFirst({
    where: { phone },
    orderBy: { authorizedAt: "desc" },
    select: { locationId: true },
  });
  const plan = await planForLocationId(cfg, planRow?.locationId);

  const created = await prisma.$transaction(async (tx) => {
    // Serialize concurrent adds for this phone so the cap check + insert
    // is atomic (two tabs submitting at once shouldn't both slip past it).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${phone}))`;

    // Only registrations still inside their authorization window count —
    // expired rows must neither fill the cap nor block re-adding a device.
    const rows = await tx.guestRegistration.findMany({
      where: { phone, revokedAt: null },
      orderBy: { authorizedAt: "desc" },
    });
    const activeDevices = latestPerMac(rows).filter((r) => isRegistrationActive(r));
    if (activeDevices.some((r) => r.macAddress === mac)) {
      throw new DeviceOpError("This device is already on the list", 409);
    }
    if (activeDevices.length >= plan.maxDevices) {
      throw new DeviceOpError(`Device limit reached (max ${plan.maxDevices})`, 400);
    }

    // Guard against hijacking a device someone else currently controls.
    const heldElsewhere = await tx.guestRegistration.findFirst({
      where: { macAddress: mac, phone: { not: phone }, revokedAt: null },
      orderBy: { authorizedAt: "desc" },
    });
    if (heldElsewhere && isRegistrationActive(heldElsewhere)) {
      throw new DeviceOpError("This device is already registered to another guest", 409);
    }

    const latest = await tx.guestRegistration.findFirst({
      where: { phone },
      orderBy: { authorizedAt: "desc" },
    });
    if (!latest) throw new DeviceOpError("Guest not found for this phone number", 404);

    if (isVerifyPending(latest) && isEmailVerificationActive(await getMailSettings())) {
      throw new DeviceOpError(
        "Confirm your email address first — check your inbox for the confirmation link",
        403,
      );
    }

    return tx.guestRegistration.create({
      data: {
        firstName: latest.firstName,
        lastName: latest.lastName,
        email: latest.email,
        emailVerifiedAt: latest.emailVerifiedAt,
        phone,
        macAddress: mac,
        label: opts.label ?? null,
        apMac: null,
        ssid: null,
        site: latest.site,
        userAgent: opts.userAgent,
        ipAddress: opts.ipAddress,
        locationType: latest.locationType,
        baseLocation: latest.baseLocation,
        building: latest.building,
        roomNumber: latest.roomNumber,
        locationId: latest.locationId,
        locationName: latest.locationName,
        durationMin: plan.durationMin,
        downKbps: plan.downKbps,
        upKbps: plan.upKbps,
      },
    });
  });

  try {
    await authorizeGuest({
      mac,
      minutes: plan.durationMin,
      downKbps: plan.downKbps,
      upKbps: plan.upKbps,
      bytesQuotaMB: plan.quotaMB,
      apMac: null,
      note: guestClientNote(created.firstName, created.lastName, created.phone),
    });
  } catch (err) {
    await prisma.guestRegistration.delete({ where: { id: created.id } }).catch(() => {});
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`Could not authorize device: ${message}`);
  }

  return created;
}

/**
 * Restarts the authorization window for a device the phone already holds:
 * re-runs UniFi authorization and inserts a fresh registration row (the same
 * shape a captive-portal re-registration produces), copying identity and
 * label from the current row. Unlike addDeviceForPhone there is no cap or
 * same-MAC duplicate check — the device is already on this phone's list;
 * only the cross-phone hijack guard applies.
 */
export async function renewDeviceForPhone(
  phone: string,
  mac: string,
  opts: { userAgent?: string; ipAddress?: string } = {},
): Promise<GuestRegistration> {
  const cfg = await getPortalConfig();

  // An unverified guest can renew, but only for the grace window — otherwise
  // renewing would bypass email verification entirely.
  const latestForPending = await prisma.guestRegistration.findFirst({
    where: { phone, macAddress: mac, revokedAt: null },
    orderBy: { authorizedAt: "desc" },
    select: { email: true, emailVerifiedAt: true, locationId: true },
  });
  const plan = await planForLocationId(cfg, latestForPending?.locationId);
  let minutes = plan.durationMin;
  if (latestForPending && isVerifyPending(latestForPending)) {
    const mail = await getMailSettings();
    if (isEmailVerificationActive(mail)) minutes = mail.emailVerifyGraceMin;
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${phone}))`;

    const current = await tx.guestRegistration.findFirst({
      where: { phone, macAddress: mac, revokedAt: null },
      orderBy: { authorizedAt: "desc" },
    });
    if (!current) throw new DeviceOpError("Device not found", 404);

    const heldElsewhere = await tx.guestRegistration.findFirst({
      where: { macAddress: mac, phone: { not: phone }, revokedAt: null },
      orderBy: { authorizedAt: "desc" },
    });
    if (heldElsewhere && isRegistrationActive(heldElsewhere)) {
      throw new DeviceOpError("This device is already registered to another guest", 409);
    }

    return tx.guestRegistration.create({
      data: {
        firstName: current.firstName,
        lastName: current.lastName,
        email: current.email,
        emailVerifiedAt: current.emailVerifiedAt,
        phone,
        macAddress: mac,
        label: current.label,
        apMac: current.apMac,
        ssid: current.ssid,
        site: current.site,
        userAgent: opts.userAgent,
        ipAddress: opts.ipAddress,
        locationType: current.locationType,
        baseLocation: current.baseLocation,
        building: current.building,
        roomNumber: current.roomNumber,
        locationId: current.locationId,
        locationName: current.locationName,
        durationMin: minutes,
        downKbps: plan.downKbps,
        upKbps: plan.upKbps,
      },
    });
  });

  try {
    await authorizeGuest({
      mac,
      minutes,
      downKbps: plan.downKbps,
      upKbps: plan.upKbps,
      bytesQuotaMB: plan.quotaMB,
      apMac: null,
      note: guestClientNote(created.firstName, created.lastName, created.phone),
    });
  } catch (err) {
    await prisma.guestRegistration.delete({ where: { id: created.id } }).catch(() => {});
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`Could not renew device: ${message}`);
  }

  return created;
}

/**
 * Unauthorizes on UniFi then soft-deletes (sets revokedAt). If `phone` is
 * given, scopes strictly to that phone (guest self-service, and the
 * per-user admin revoke) and requires a matching active row to exist, so a
 * caller can't revoke someone else's device by guessing a MAC. If omitted
 * (the general admin/sessions revoke button, which acts on live UniFi
 * sessions that may not have a matching DB row — e.g. already revoked in
 * the DB, or authorized outside this app), it always unauthorizes on UniFi
 * and best-effort marks any matching rows revoked, without requiring one to
 * exist first — the DB is bookkeeping here, not a precondition for network
 * access control.
 */
export async function revokeDevice(mac: string, phone?: string): Promise<void> {
  if (phone) {
    const rows = await prisma.guestRegistration.findMany({
      where: { phone, macAddress: mac, revokedAt: null },
    });
    if (rows.length === 0) throw new DeviceOpError("Device not found", 404);
  }

  await unauthorizeGuest(mac);

  await prisma.guestRegistration.updateMany({
    where: phone ? { phone, macAddress: mac, revokedAt: null } : { macAddress: mac, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
