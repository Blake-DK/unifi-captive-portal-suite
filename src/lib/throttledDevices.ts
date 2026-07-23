import { prisma } from "./prisma";

export type ThrottleInfo = {
  downKbps: number;
  upKbps: number;
  throttledBy: string;
  throttledAt: Date;
};

/** MAC (lowercase) -> throttle record, for pages that list individual clients. */
export async function getThrottledDevicesMap(): Promise<Map<string, ThrottleInfo>> {
  const rows = await prisma.throttledDevice.findMany();
  return new Map(
    rows.map((r) => [
      r.mac.toLowerCase(),
      { downKbps: r.downKbps, upKbps: r.upKbps, throttledBy: r.throttledBy, throttledAt: r.throttledAt },
    ]),
  );
}
