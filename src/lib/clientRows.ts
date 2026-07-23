import { getNameMaps, listStations, type UniFiStation } from "./unifi";
import { physicalMacForm } from "./mac";
import { detectExtenders } from "./rogueExtenders";
import { hiddenMacs } from "./rogueUnifi";
import { getBlockedDevicesMap } from "./blockedDevices";
import { getThrottledDevicesMap } from "./throttledDevices";
import { prisma } from "./prisma";
import { formatBytes } from "./utils";
import type { ClientRow } from "@/components/admin/ClientsTable";

export type LoadClientsResult = {
  stations: UniFiStation[];
  rows: ClientRow[];
  blockedByMac: Awaited<ReturnType<typeof getBlockedDevicesMap>>;
  error: string | null;
};

/**
 * Shared assembly of the connected-client table rows, used by both
 * `/admin/clients` (all rows) and `/admin/extenders` (filtered to flagged).
 * One place so the row shape, extender flagging, owner resolution, and
 * byte/label formatting can't drift between the two pages.
 */
export async function loadClients(): Promise<LoadClientsResult> {
  let stations: UniFiStation[] = [];
  let error: string | null = null;
  let deviceName = new Map<string, string>();
  let networkNameById = new Map<string, string>();

  try {
    stations = await listStations();
    let deviceMacs: Set<string>;
    ({ deviceName, deviceMacs, networkNameById } = await getNameMaps());
    // stat/sta lists adopted UniFi devices (APs, switches) as wired clients of
    // their uplink — under their base MAC, an interface/BSSID MAC, or a
    // virtual MAC derived via the locally-administered bit. They are
    // infrastructure, not guests: keep them out of the table so the extender
    // heuristic can't flag an AP and offer to block it (the controller
    // refuses with api.err.BlockUnifiDeviceForbidden anyway). deviceMacs is
    // stored in physicalMacForm, so probe in the same form.
    stations = stations.filter((s) => !deviceMacs.has(physicalMacForm(s.mac)));
    // Un-onboarded UniFi hardware the operator ignored (a neighbour's router,
    // gear on a shared uplink) also leaves the client tables — it isn't a
    // guest, and it can't be blocked. Devices marked but NOT ignored stay
    // visible here; the Un-onboarded tab is where they get handled.
    const hidden = hiddenMacs(await prisma.rogueUnifiDevice.findMany().catch(() => []));
    if (hidden.size > 0) stations = stations.filter((s) => !hidden.has(s.mac.toLowerCase()));
  } catch (err) {
    error = err instanceof Error ? err.message : "Error querying UniFi";
  }

  const macs = stations.map((s) => s.mac.toLowerCase());
  const registrations = await prisma.guestRegistration.findMany({
    where: { macAddress: { in: macs } },
    orderBy: { authorizedAt: "desc" },
  });
  // Newest-first order + keep the first seen per MAC = the current registrant
  // wins when a MAC has been registered more than once.
  const ownerByMac = new Map<string, (typeof registrations)[number]>();
  for (const r of registrations) if (!ownerByMac.has(r.macAddress)) ownerByMac.set(r.macAddress, r);

  const blockedByMac = await getBlockedDevicesMap();
  const throttledByMac = await getThrottledDevicesMap();
  const matches = detectExtenders(stations);

  const rows: ClientRow[] = stations.map((sta) => {
    const mac = sta.mac.toLowerCase();
    const reg = ownerByMac.get(mac);
    const network = (sta.network_id ? networkNameById.get(sta.network_id) : undefined) ?? sta.network;
    const match = matches.get(mac);
    const blocked = blockedByMac.get(mac);
    const throttled = throttledByMac.get(mac);
    return {
      mac: sta.mac,
      owner: reg ? { name: `${reg.firstName} ${reg.lastName}`, phone: reg.phone } : null,
      hostname: sta.name ?? sta.hostname ?? "-",
      wired: Boolean(sta.is_wired),
      ip: sta.ip ?? "-",
      ssid: sta.essid ?? "-",
      apOrSwitch: sta.is_wired
        ? sta.sw_mac
          ? `${deviceName.get(sta.sw_mac.toLowerCase()) ?? sta.sw_mac}${sta.sw_port != null ? `:${sta.sw_port}` : ""}`
          : "-"
        : sta.ap_mac
          ? deviceName.get(sta.ap_mac.toLowerCase()) ?? sta.ap_mac
          : "-",
      vlanNetwork: `${sta.vlan ?? "-"}${network ? ` / ${network}` : ""}`,
      rx: formatBytes(sta.rx_bytes ?? 0),
      tx: formatBytes(sta.tx_bytes ?? 0),
      flag: match ? { confidence: match.confidence, reason: match.reason, vendor: match.vendor } : null,
      blocked: blocked ? { ...blocked, blockedAt: blocked.blockedAt.toISOString() } : null,
      throttled: throttled ? { ...throttled, throttledAt: throttled.throttledAt.toISOString() } : null,
    };
  });

  return { stations, rows, blockedByMac, error };
}
