import type { UniFiDeviceHealth, UniFiStation } from "./unifi";
import { uplinkOf } from "./vlanTrace";

/**
 * Builds the physical topology tree (gateway -> switches -> APs/devices) from
 * the controller's per-device uplink pointers, and tallies the clients hanging
 * off each device. This is the model behind the /admin/map page: nodes nest
 * under whatever they uplink through, which is exactly "group switches and APs
 * by who they're connected to".
 */

export type TopoNode = {
  mac: string;
  name: string;
  type: string; // uap | usw | udm | ugw | uxg | ...
  model?: string;
  ip?: string;
  state: number; // 0 offline, 1 online, others = transitional
  online: boolean;
  uptime?: number;
  lastSeen?: number; // epoch seconds of the last controller contact
  version?: string;
  upgradable?: boolean;
  cpu?: number;
  mem?: number;
  temperature?: number; // °C, hottest reported sensor; undefined = no sensors
  fanLevel?: number;
  overheating?: boolean;
  // true only when the controller exposes both config-fingerprint fields AND
  // they differ; undefined (not false) when we can't tell, so the UI can
  // distinguish "confirmed in sync" from "unknown" from "confirmed stale".
  configStale?: boolean;
  satisfaction?: number;
  // link from this node up to its parent
  uplinkPortIdx?: number; // remote port on the parent
  uplinkSpeed?: number; // Mbps
  uplinkPoe?: number; // watts, if the parent port powers this device
  wirelessUplink?: boolean;
  clients: number; // clients directly attached to this device
  children: TopoNode[];
  radios?: { radio?: string; channel?: number; cu_total?: number; num_sta?: number }[];
  ports?: number; // total ports (switches)
  portsUp?: number;
  poePorts?: { portIdx: number; name?: string; poe: number }[]; // PoE-capable ports, for power-cycle
  locating?: boolean; // LED currently blinking (locate on)
};

const norm = (m?: string) => (m ?? "").toLowerCase();

// Hottest reported sensor: single-sensor devices expose general_temperature,
// gateways a temperatures[] array. Field availability is model-dependent, so
// undefined (no sensors) is the common case and callers render nothing then.
function deviceTemperature(d: UniFiDeviceHealth): number | undefined {
  if (typeof d.general_temperature === "number") return d.general_temperature;
  const vals = (d.temperatures ?? []).map((t) => Number(t.value)).filter((v) => Number.isFinite(v));
  return vals.length ? Math.max(...vals) : undefined;
}

function clientCounts(stations: UniFiStation[]): Map<string, number> {
  const byDevice = new Map<string, number>();
  for (const s of stations) {
    const anchor = s.is_wired ? s.sw_mac : s.ap_mac;
    if (!anchor) continue;
    byDevice.set(norm(anchor), (byDevice.get(norm(anchor)) ?? 0) + 1);
  }
  return byDevice;
}

function toNode(d: UniFiDeviceHealth, clients: number): TopoNode {
  const ss = d["system-stats"] ?? {};
  const ports = d.port_table ?? [];
  return {
    mac: d.mac,
    name: d.name || d.mac,
    type: d.type ?? "unknown",
    model: d.model,
    ip: d.ip,
    state: d.state ?? 0,
    online: d.state === 1,
    uptime: d.uptime,
    lastSeen: d.last_seen,
    version: d.version,
    upgradable: d.upgradable,
    cpu: ss.cpu !== undefined ? Number(ss.cpu) : undefined,
    mem: ss.mem !== undefined ? Number(ss.mem) : undefined,
    temperature: deviceTemperature(d),
    fanLevel: d.fan_level !== undefined ? Number(d.fan_level) : undefined,
    overheating: d.overheating === true || undefined,
    configStale: d.cfgversion !== undefined && d.known_cfgversion !== undefined ? d.cfgversion !== d.known_cfgversion : undefined,
    satisfaction: d.satisfaction,
    clients,
    children: [],
    radios: (d.radio_table_stats ?? []).map((r) => ({
      radio: r.radio,
      channel: r.channel,
      cu_total: r.cu_total,
      num_sta: r.num_sta,
    })),
    ports: ports.length || undefined,
    portsUp: ports.length ? ports.filter((p) => p.up).length : undefined,
    // PoE-*capable* ports (not just those drawing right now) so a port whose
    // powered device has died — exactly when you want to power-cycle it — still
    // shows a control. Capability is preferred; fall back to a live draw when
    // the controller doesn't report the capability flags.
    poePorts: ports
      .filter(
        (p) =>
          p.port_idx !== undefined &&
          ((p.port_poe === true && (p.poe_mode ?? "auto") !== "off") ||
            (p.poe_power != null && Number(p.poe_power) > 0)),
      )
      .map((p) => ({ portIdx: p.port_idx!, name: p.name, poe: Number(p.poe_power ?? 0) || 0 })),
    locating: d.locating,
  };
}

/** Flat nodes, no parent/child links — for surfaces that show devices in a
 * table (Status) but want the map's device dialog, which speaks TopoNode. */
export function deviceNodes(devices: UniFiDeviceHealth[], stations: UniFiStation[]): TopoNode[] {
  const counts = clientCounts(stations);
  return devices.map((d) => toNode(d, counts.get(norm(d.mac)) ?? 0));
}

export type Topology = {
  roots: TopoNode[]; // usually the gateway(s); orphans (no resolvable uplink) also surface here
  totalDevices: number;
  online: number;
};

export function buildTopology(devices: UniFiDeviceHealth[], stations: UniFiStation[]): Topology {
  const counts = clientCounts(stations);
  const nodes = new Map<string, TopoNode>();
  for (const d of devices) nodes.set(norm(d.mac), toNode(d, counts.get(norm(d.mac)) ?? 0));

  const isGateway = (t: string) => t === "udm" || t === "ugw" || t === "uxg";
  const roots: TopoNode[] = [];
  const attached = new Set<string>();

  for (const d of devices) {
    const node = nodes.get(norm(d.mac))!;
    const up = uplinkOf(d);
    const parent = up?.uplink_mac ? nodes.get(norm(up.uplink_mac)) : undefined;

    if (isGateway(d.type ?? "") || !parent || norm(parent.mac) === norm(d.mac)) {
      roots.push(node);
      continue;
    }

    // Decorate the child->parent link, then nest.
    node.uplinkPortIdx = up?.uplink_remote_port;
    node.wirelessUplink = up?.type === "wireless";
    const parentPort = up?.uplink_remote_port
      ? (devices.find((x) => norm(x.mac) === norm(parent.mac))?.port_table ?? []).find(
          (p) => p.port_idx === up.uplink_remote_port,
        )
      : undefined;
    node.uplinkSpeed = parentPort?.speed;
    node.uplinkPoe = parentPort?.poe_power ? Number(parentPort.poe_power) : undefined;
    parent.children.push(node);
    attached.add(norm(d.mac));
  }

  // Stable ordering: gateways first, then switches, then APs, then by name.
  const rank = (n: TopoNode) => (isGateway(n.type) ? 0 : n.type === "usw" ? 1 : 2);
  const sortRec = (n: TopoNode) => {
    n.children.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    n.children.forEach(sortRec);
  };
  roots.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  roots.forEach(sortRec);

  return {
    roots,
    totalDevices: devices.length,
    online: devices.filter((d) => d.state === 1).length,
  };
}
