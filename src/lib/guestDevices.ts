import { prisma } from "./prisma";
import type { GuestRegistration } from "@prisma/client";

/**
 * A registration grants network access from authorizedAt for durationMin
 * minutes; durationMin <= 0 means it never expires. Rows past their window
 * are spent — they must not count toward the device cap and must not block
 * re-registering the same MAC.
 */
export function isRegistrationActive(
  r: Pick<GuestRegistration, "revokedAt" | "authorizedAt" | "durationMin">,
  now = Date.now(),
): boolean {
  if (r.revokedAt) return false;
  if (r.durationMin <= 0) return true;
  return r.authorizedAt.getTime() + r.durationMin * 60_000 > now;
}

/**
 * A phone may have multiple rows for the same MAC (re-registered via
 * /portal before expiry) — keep only the most recent per MAC, since that row
 * determines the current authorization window.
 */
export function latestPerMac<T extends Pick<GuestRegistration, "macAddress">>(rows: T[]): T[] {
  const byMac = new Map<string, T>();
  for (const r of rows) if (!byMac.has(r.macAddress)) byMac.set(r.macAddress, r);
  return [...byMac.values()];
}

export async function getActiveDevicesForPhone(phone: string): Promise<GuestRegistration[]> {
  const rows = await prisma.guestRegistration.findMany({
    where: { phone, revokedAt: null },
    orderBy: { authorizedAt: "desc" },
  });
  return latestPerMac(rows).filter((r) => isRegistrationActive(r));
}
