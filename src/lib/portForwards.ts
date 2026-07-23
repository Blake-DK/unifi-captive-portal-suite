import { prisma } from "./prisma";
import {
  listPortForwards,
  listUpnpMappings,
  listStations,
  listNetworks,
  getNameMaps,
  type UniFiPortForward,
  type UniFiUpnpMapping,
} from "./unifi";
import { buildExposureGroups, type EnrichStation, type ExposureGroup } from "./portForwardsCore";

export type { ExposureRow, ExposureGroup } from "./portForwardsCore";
export { exposureKey } from "./portForwardsCore";

export type PortForwardsResult = {
  groups: ExposureGroup[];
  total: number;
  /** Whether the controller exposed a live UPnP lease table at all. */
  upnpAvailable: boolean;
  upnpCount: number;
  error: string | null;
};

/**
 * Load every inbound exposure (static port-forwards + dynamic UPnP leases),
 * enrich each with the LAN device it targets, attach operator notes, and group
 * by device. Never throws: on a controller failure it returns an empty result
 * with `error` set so the page renders a banner (per CLAUDE.md admin-page rule).
 */
export async function loadPortForwards(): Promise<PortForwardsResult> {
  let forwards: UniFiPortForward[] = [];
  let upnp: { mappings: UniFiUpnpMapping[]; available: boolean } = { mappings: [], available: false };
  let stations: Awaited<ReturnType<typeof listStations>> = [];
  let networks: Awaited<ReturnType<typeof listNetworks>> = [];
  let nameMaps: Awaited<ReturnType<typeof getNameMaps>> | null = null;

  try {
    // Port-forwards are the hard dependency; the rest are best-effort enrichment
    // so a single failing lookup never blanks the whole page.
    [forwards, upnp, stations, networks, nameMaps] = await Promise.all([
      listPortForwards(),
      listUpnpMappings().catch(() => ({ mappings: [], available: false })),
      listStations().catch(() => []),
      listNetworks().catch(() => []),
      getNameMaps().catch(() => null),
    ]);
  } catch (e) {
    const error = e instanceof Error ? e.message : "Controller unreachable";
    return { groups: [], total: 0, upnpAvailable: false, upnpCount: 0, error };
  }

  // ip -> station, for resolving the internal target to a device name/MAC.
  const stationByIp = new Map<string, EnrichStation>();
  for (const s of stations) if (s.ip) stationByIp.set(s.ip, s);
  const networkNameById = nameMaps?.networkNameById ?? new Map<string, string>();
  const deviceName = nameMaps?.deviceName ?? new Map<string, string>();

  const notes = await prisma.portForwardNote
    .findMany()
    .catch(() => [] as { key: string; note: string }[]);
  const noteByKey = new Map(notes.map((n) => [n.key, n.note]));

  const { groups, total } = buildExposureGroups({
    forwards,
    upnpMappings: upnp.mappings,
    stationByIp,
    deviceName,
    networkNameById,
    networks,
    noteByKey,
  });

  return {
    groups,
    total,
    upnpAvailable: upnp.available,
    upnpCount: upnp.mappings.length,
    error: null,
  };
}
