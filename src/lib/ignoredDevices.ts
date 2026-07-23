import { prisma } from "./prisma";
import { adjustHealthForIgnored } from "./issues";
import type { UniFiDeviceHealth, UniFiSubsystemHealth } from "./unifi";

/**
 * Site-wide ignores for adopted devices that are offline on purpose — a
 * decommissioned AP still in the controller, gear boxed up for a rebuild.
 * One decision, honoured everywhere: the map, the device counts, the issues
 * list and the offline alert all skip an ignored device.
 *
 * The ignore is deliberately NOT permanent. A device that comes back online
 * clears its own ignore, so returning hardware is never silently unmonitored
 * — the same "until it reconnects" semantics as the un-onboarded tab.
 */

export type IgnoredDeviceRow = {
  mac: string;
  name: string;
  note: string;
  createdBy: string;
  createdAt: Date;
};

/** The ignore rows currently in force, keyed by lowercase MAC, after clearing
 * any whose device is back online. `devices` is the live device list; pass it
 * so the sweep is free. The row carries who ignored it, why, and since when. */
export async function activeIgnores(
  devices: { mac: string; state?: number }[],
): Promise<Map<string, IgnoredDeviceRow>> {
  const rows = await prisma.ignoredDevice.findMany().catch(() => [] as IgnoredDeviceRow[]);
  if (rows.length === 0) return new Map();

  const onlineNow = new Set(
    devices.filter((d) => d.state === 1).map((d) => d.mac.toLowerCase()),
  );
  const revived = rows.map((r) => r.mac).filter((m) => onlineNow.has(m));
  if (revived.length > 0) {
    // Fire-and-forget: a failed cleanup only means the row is swept next time.
    void prisma.ignoredDevice
      .deleteMany({ where: { mac: { in: revived } } })
      .catch((e) => console.error("ignoredDevice sweep failed:", e));
  }
  return new Map(rows.filter((r) => !onlineNow.has(r.mac)).map((r) => [r.mac, r]));
}

/** MACs currently ignored — activeIgnores when only the set matters. */
export async function activeIgnoredMacs(
  devices: { mac: string; state?: number }[],
): Promise<Set<string>> {
  return new Set((await activeIgnores(devices)).keys());
}

/** Ignores as stored, for the management list (no sweep). */
export async function listIgnoredDevices(): Promise<IgnoredDeviceRow[]> {
  return prisma.ignoredDevice.findMany({ orderBy: { createdAt: "desc" } }).catch(() => []);
}

/**
 * The one choke point for honouring ignores: sweep, filter the device list
 * AND adjust the controller's health counts in a single call, so a surface
 * cannot adopt one half and forget the other. Every reader of devices/health
 * goes through here — pages, the alert monitor, the dashboard score and live
 * route, the metric sampler and the runbooks.
 */
export async function applyDeviceIgnores(
  devices: UniFiDeviceHealth[],
  health: UniFiSubsystemHealth[] = [],
): Promise<{
  devices: UniFiDeviceHealth[];
  health: UniFiSubsystemHealth[];
  ignored: UniFiDeviceHealth[];
  ignoredMacs: Set<string>;
  /** The ignore rows behind ignoredMacs (who/why/since), same lowercase keys. */
  ignores: Map<string, IgnoredDeviceRow>;
}> {
  const ignores = await activeIgnores(devices);
  const ignoredMacs = new Set(ignores.keys());
  if (ignoredMacs.size === 0) return { devices, health, ignored: [], ignoredMacs, ignores };
  const ignored = devices.filter((d) => ignoredMacs.has(d.mac.toLowerCase()));
  const visible = devices.filter((d) => !ignoredMacs.has(d.mac.toLowerCase()));
  return {
    devices: visible,
    health: adjustHealthForIgnored(health, ignored, visible),
    ignored,
    ignoredMacs,
    ignores,
  };
}
