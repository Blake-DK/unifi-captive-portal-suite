import { prisma } from "./prisma";

export type BlockedDeviceInfo = {
  reason: string;
  blockedBy: string;
  blockedAt: Date;
};

/** MAC (lowercase) -> block record, for pages that list individual client rows. */
export async function getBlockedDevicesMap(): Promise<Map<string, BlockedDeviceInfo>> {
  const rows = await prisma.blockedDevice.findMany();
  return new Map(
    rows.map((r) => [r.mac.toLowerCase(), { reason: r.reason, blockedBy: r.blockedBy, blockedAt: r.blockedAt }]),
  );
}
