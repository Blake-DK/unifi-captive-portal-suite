// Pure normalize → enrich → group logic for the UPnP Inspector, split from the
// I/O in portForwards.ts so it unit-tests without pulling in prisma/undici.
// UniFi shapes are TYPE-only imports (erased at runtime), so importing this
// module never loads the controller client.
import type { UniFiPortForward, UniFiUpnpMapping } from "./unifi";

/** One inbound-exposure entry, static or dynamic, enriched with the LAN device
 * it points at. `key` is the stable id the operator note hangs off. */
export type ExposureRow = {
  key: string;
  id: string | null;
  name: string;
  enabled: boolean;
  source: "port-forward" | "upnp";
  proto: string; // tcp | udp | tcp_udp
  wanPort: string; // external, internet-facing
  fwdIp: string; // internal target
  fwdPort: string; // internal port
  src: string; // "any" | CIDR restriction
  wan: string; // which uplink (port-forwards only)
  logged: boolean;
  // enrichment (null when the target device is offline / unknown)
  deviceName: string | null;
  deviceMac: string | null;
  network: string | null;
  note: string;
};

/** Rows grouped by the internal device they expose. */
export type ExposureGroup = {
  deviceKey: string; // fwdIp — stable grouping key even when the name is unknown
  deviceLabel: string; // resolved name, else the IP
  deviceMac: string | null;
  network: string | null;
  rows: ExposureRow[];
};

/** The station fields the enrichment reads — a structural subset so tests can
 * supply plain objects without the full UniFiStation shape. */
export type EnrichStation = {
  mac: string;
  name?: string;
  hostname?: string;
  network?: string;
  network_id?: string;
};

export type BuildExposureInput = {
  forwards: UniFiPortForward[];
  upnpMappings: UniFiUpnpMapping[];
  stationByIp: Map<string, EnrichStation>;
  deviceName: Map<string, string>; // mac(lower) -> device name
  networkNameById: Map<string, string>; // networkconf _id -> name
  networks: { name: string; ip_subnet?: string }[];
  noteByKey: Map<string, string>;
};

/** Stable descriptor used both as the React key and the PortForwardNote id.
 * Deliberately independent of the controller's _id, which churns on edit. */
export function exposureKey(source: string, proto: string, wanPort: string, fwdIp: string, fwdPort: string): string {
  return `${source}:${(proto || "any").toLowerCase()}:${wanPort || "*"}->${fwdIp || "?"}:${fwdPort || "*"}`;
}

type BaseRow = Omit<ExposureRow, "deviceName" | "deviceMac" | "network" | "note">;

function normalizePortForward(pf: UniFiPortForward): BaseRow {
  const proto = (pf.proto ?? "tcp_udp").toLowerCase();
  const wanPort = String(pf.dst_port ?? "");
  const fwdIp = pf.fwd ?? "";
  const fwdPort = String(pf.fwd_port ?? "");
  return {
    key: exposureKey("port-forward", proto, wanPort, fwdIp, fwdPort),
    id: pf._id ?? null,
    name: pf.name?.trim() || `${proto.toUpperCase()} ${wanPort}`,
    enabled: pf.enabled !== false,
    source: "port-forward",
    proto,
    wanPort,
    fwdIp,
    fwdPort,
    src: pf.src?.trim() || "any",
    wan: pf.pfwd_interface ?? "wan",
    logged: pf.log === true,
  };
}

function normalizeUpnp(m: UniFiUpnpMapping): BaseRow {
  const proto = String(m.proto ?? "tcp_udp").toLowerCase();
  const wanPort = String(m.ext_port ?? "");
  const fwdIp = String(m.int_ip ?? "");
  const fwdPort = String(m.int_port ?? "");
  return {
    key: exposureKey("upnp", proto, wanPort, fwdIp, fwdPort),
    id: null,
    name: (typeof m.description === "string" && m.description.trim()) || `UPnP ${proto.toUpperCase()} ${wanPort}`,
    enabled: true, // a live lease is by definition active
    source: "upnp",
    proto,
    wanPort,
    fwdIp,
    fwdPort,
    src: "any",
    wan: "wan",
    logged: false,
  };
}

/**
 * Normalize → enrich → group. Each forward/lease is joined to the LAN device it
 * targets (by internal IP) and grouped under that device; groups sort by label.
 */
export function buildExposureGroups(input: BuildExposureInput): { groups: ExposureGroup[]; total: number } {
  const { forwards, upnpMappings, stationByIp, deviceName, networkNameById, networks, noteByKey } = input;
  const bases = [...forwards.map(normalizePortForward), ...upnpMappings.map(normalizeUpnp)];

  const rows: ExposureRow[] = bases.map((b) => {
    const st = b.fwdIp ? stationByIp.get(b.fwdIp) : undefined;
    const mac = st?.mac ?? null;
    const name =
      st?.name?.trim() ||
      st?.hostname?.trim() ||
      (mac ? deviceName.get(mac.toLowerCase()) : undefined) ||
      null;
    const network =
      (st?.network_id ? networkNameById.get(st.network_id) : undefined) ??
      st?.network ??
      networkForIp(b.fwdIp, networks) ??
      null;
    return { ...b, deviceName: name, deviceMac: mac, network, note: noteByKey.get(b.key) ?? "" };
  });

  // Group by internal IP so every exposure for one device sits together.
  const groupMap = new Map<string, ExposureGroup>();
  for (const r of rows) {
    const gk = r.fwdIp || "(no target)";
    let g = groupMap.get(gk);
    if (!g) {
      g = {
        deviceKey: gk,
        deviceLabel: r.deviceName || r.fwdIp || "Unknown device",
        deviceMac: r.deviceMac,
        network: r.network,
        rows: [],
      };
      groupMap.set(gk, g);
    }
    // First non-null enrichment wins for the group header.
    if (!g.deviceMac && r.deviceMac) g.deviceMac = r.deviceMac;
    if ((g.deviceLabel === g.deviceKey || g.deviceLabel === "Unknown device") && r.deviceName) g.deviceLabel = r.deviceName;
    if (!g.network && r.network) g.network = r.network;
    g.rows.push(r);
  }

  const groups = [...groupMap.values()].sort((a, b) => a.deviceLabel.localeCompare(b.deviceLabel));
  return { groups, total: rows.length };
}

/** Best-effort network name for an IP by matching it against each network's
 * ip_subnet CIDR. Only handles the common IPv4 /8–/30 case — enough to label a
 * forward's target VLAN when the device is offline (no station row). */
function networkForIp(ip: string, networks: { name: string; ip_subnet?: string }[]): string | null {
  if (!ip) return null;
  const addr = ipv4ToInt(ip);
  if (addr === null) return null;
  for (const net of networks) {
    const cidr = net.ip_subnet;
    if (!cidr || !cidr.includes("/")) continue;
    const [base, bitsRaw] = cidr.split("/");
    const bits = Number(bitsRaw);
    const baseInt = ipv4ToInt(base);
    if (baseInt === null || !Number.isFinite(bits) || bits < 0 || bits > 32) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((addr & mask) === (baseInt & mask)) return net.name;
  }
  return null;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}
