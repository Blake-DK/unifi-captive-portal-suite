import { getHourlyUserStats } from "./unifi";

export type DeviceUsage = {
  totalBytes: number;
  rxBytes: number;
  txBytes: number;
  /** One point per hour over the window, zero-filled, oldest first. */
  hourly: { time: number; bytes: number }[];
};

const TTL_MS = 60_000;
const MAX_ENTRIES = 100;

const cache = new Map<string, { expiresAt: number; data: Promise<Map<string, DeviceUsage>> }>();

/**
 * Usage over the last `hours` for a set of MACs, from the controller's
 * hourly report store. Cached briefly per MAC-set (same pattern as
 * liveStatus.ts) so table renders don't hammer the controller.
 */
export async function getUsageForMacs(
  macs: string[],
  hours = 24,
): Promise<Map<string, DeviceUsage>> {
  const normalized = [...new Set(macs.map((m) => m.toLowerCase()))].sort();
  if (normalized.length === 0) return new Map();

  const key = `${hours}:${normalized.join(",")}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  const data = fetchUsage(normalized, hours);
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, { expiresAt: Date.now() + TTL_MS, data });
  // Evict on failure so the next caller retries instead of inheriting a
  // rejected promise for the rest of the TTL window.
  data.catch(() => {
    cache.delete(key);
  });
  return data;
}

async function fetchUsage(macs: string[], hours: number): Promise<Map<string, DeviceUsage>> {
  const HOUR_MS = 3_600_000;
  const endHour = Math.ceil(Date.now() / HOUR_MS) * HOUR_MS;
  const startHour = endHour - hours * HOUR_MS;

  const rows = await getHourlyUserStats(macs, startHour, endHour);

  const out = new Map<string, DeviceUsage>();
  for (const mac of macs) {
    out.set(mac, {
      totalBytes: 0,
      rxBytes: 0,
      txBytes: 0,
      hourly: Array.from({ length: hours }, (_, i) => ({
        time: startHour + i * HOUR_MS,
        bytes: 0,
      })),
    });
  }
  for (const r of rows) {
    const usage = out.get(r.mac);
    if (!usage) continue;
    const bytes = r.rxBytes + r.txBytes;
    usage.rxBytes += r.rxBytes;
    usage.txBytes += r.txBytes;
    usage.totalBytes += bytes;
    const idx = Math.floor((r.time - startHour) / HOUR_MS);
    if (idx >= 0 && idx < usage.hourly.length) usage.hourly[idx].bytes += bytes;
  }
  return out;
}
