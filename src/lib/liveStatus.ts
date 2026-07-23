import { listStations, listAccessPoints, type UniFiStation } from "./unifi";

export type LiveDeviceStatus = {
  online: boolean;
  apMac?: string;
  apName?: string; // falls back to apMac if the AP isn't in listAccessPoints()
  ssid?: string;
  ip?: string;
  hostname?: string; // UniFi-detected name, read-only reference distinct from a guest's editable label
  vlan?: number;
  network?: string;
};

type Snapshot = {
  stationsByMac: Map<string, UniFiStation>;
  apNameByMac: Map<string, string>;
};

const TTL_MS = 20_000;

let cache: { expiresAt: number; data: Promise<Snapshot> } | null = null;

function getSnapshot(): Promise<Snapshot> {
  if (cache && cache.expiresAt > Date.now()) return cache.data;

  const dataPromise = Promise.all([listStations(), listAccessPoints()]).then(
    ([stations, aps]) => ({
      stationsByMac: new Map(stations.map((s) => [s.mac.toLowerCase(), s])),
      apNameByMac: new Map(aps.map((a) => [a.mac.toLowerCase(), a.name || a.mac])),
    }),
  );

  cache = { expiresAt: Date.now() + TTL_MS, data: dataPromise };
  // If the fetch fails, evict so the next caller retries instead of being
  // stuck with a rejected promise for the rest of the TTL window.
  dataPromise.catch(() => {
    cache = null;
  });

  return dataPromise;
}

/**
 * Batched, cached lookup of live connection status for a set of MACs — one
 * shared UniFi round-trip per TTL window regardless of how many callers ask
 * concurrently, so guests loading /portal/my-devices at the same time don't
 * each trigger a fresh controller request.
 */
export async function getLiveStatusForMacs(
  macs: string[],
): Promise<Map<string, LiveDeviceStatus>> {
  const { stationsByMac, apNameByMac } = await getSnapshot();
  const out = new Map<string, LiveDeviceStatus>();
  for (const mac of macs) {
    const s = stationsByMac.get(mac.toLowerCase());
    if (!s) {
      out.set(mac, { online: false });
      continue;
    }
    out.set(mac, {
      online: true,
      apMac: s.ap_mac,
      apName: s.ap_mac ? (apNameByMac.get(s.ap_mac.toLowerCase()) ?? s.ap_mac) : undefined,
      ssid: s.essid,
      ip: s.ip,
      hostname: s.name || s.hostname,
      vlan: s.vlan,
      network: s.network,
    });
  }
  return out;
}
