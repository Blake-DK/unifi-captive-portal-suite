import type { UniFiDeviceHealth, UniFiNetwork, UniFiPort } from "./unifi";

/**
 * L2 path tracing: does a given network/VLAN actually make it through the
 * switch-port chain between a device (usually an AP) and the gateway?
 * UniFi models per-port VLAN behavior with `forward` + native/tagged fields;
 * a guest VLAN excluded on any hop silently strands clients with no DHCP.
 */

export type PortVerdict = boolean | undefined; // undefined = port unknown

/** Whether one switch/gateway port carries the given network. */
export function portCarries(port: UniFiPort | undefined, networkId: string): PortVerdict {
  if (!port) return undefined;
  const fwd = port.forward ?? "all";
  if (fwd === "all") return true;
  if (fwd === "disabled") return false;
  if (port.native_networkconf_id === networkId) return true;
  if (fwd === "native") return false;
  // "customize": native handled above, now the tagged set
  const mgmt = port.tagged_vlan_mgmt ?? "auto";
  if (mgmt === "block_all") return false;
  if ((port.excluded_networkconf_ids ?? []).includes(networkId)) return false;
  return true;
}

/** Human summary of a port's VLAN behavior, for tables and findings. */
export function portVlanSummary(port: UniFiPort, netName: (id?: string) => string): string {
  const fwd = port.forward ?? "all";
  if (fwd === "all") return "All VLANs";
  if (fwd === "disabled") return "Disabled";
  const native = `native ${netName(port.native_networkconf_id)}`;
  if (fwd === "native") return `Access port (${native}, no tagged)`;
  const mgmt = port.tagged_vlan_mgmt ?? "auto";
  if (mgmt === "block_all") return `${native}, tagged blocked`;
  const excluded = port.excluded_networkconf_ids ?? [];
  if (excluded.length > 0) return `${native}, tagged all except ${excluded.map(netName).join(", ")}`;
  return `${native}, all tagged`;
}

export type UplinkHop = {
  device: UniFiDeviceHealth; // the upstream device
  port?: UniFiPort; // the upstream device's port we arrive on
  portIdx?: number;
  wireless?: boolean;
};

const norm = (mac?: string) => (mac ?? "").toLowerCase();

export function uplinkOf(d: UniFiDeviceHealth) {
  return d.uplink?.uplink_mac ? d.uplink : d.last_uplink;
}

/**
 * Walk uplinks from a device toward the gateway. Stops at the gateway, at a
 * device with no uplink info, or after 8 hops (loop guard).
 */
export function traceUplinkChain(devices: UniFiDeviceHealth[], from: UniFiDeviceHealth): UplinkHop[] {
  const byMac = new Map(devices.map((d) => [norm(d.mac), d]));
  const hops: UplinkHop[] = [];
  const seen = new Set<string>([norm(from.mac)]);
  let current = from;
  for (let i = 0; i < 8; i++) {
    const up = uplinkOf(current);
    const upstream = up?.uplink_mac ? byMac.get(norm(up.uplink_mac)) : undefined;
    if (!upstream || seen.has(norm(upstream.mac))) break;
    const port = up?.uplink_remote_port
      ? (upstream.port_table ?? []).find((p) => p.port_idx === up.uplink_remote_port)
      : undefined;
    hops.push({ device: upstream, port, portIdx: up?.uplink_remote_port, wireless: up?.type === "wireless" });
    seen.add(norm(upstream.mac));
    const t = upstream.type ?? "";
    if (t === "udm" || t === "ugw" || t === "uxg") break;
    current = upstream;
  }
  return hops;
}

export type VlanPathResult = {
  ok: boolean;
  unknown: boolean; // no hop data to judge
  blockedAt?: { deviceName: string; portIdx?: number; summary: string };
  hops: UplinkHop[];
};

/** Check a network/VLAN across a device's whole uplink chain. */
export function checkVlanPath(
  devices: UniFiDeviceHealth[],
  from: UniFiDeviceHealth,
  networkId: string,
  networks: UniFiNetwork[],
): VlanPathResult {
  const netName = (id?: string) => {
    const n = networks.find((x) => x._id === id);
    return n ? `${n.name}${n.vlan ? ` (VLAN ${n.vlan})` : ""}` : (id ?? "default");
  };
  const hops = traceUplinkChain(devices, from);
  if (hops.length === 0) return { ok: true, unknown: true, hops };
  for (const hop of hops) {
    if (hop.wireless) continue; // meshed hop — no port to inspect
    const verdict = portCarries(hop.port, networkId);
    if (verdict === false) {
      return {
        ok: false,
        unknown: false,
        blockedAt: {
          deviceName: hop.device.name || hop.device.mac,
          portIdx: hop.portIdx,
          summary: hop.port ? portVlanSummary(hop.port, netName) : "port not found",
        },
        hops,
      };
    }
  }
  return { ok: true, unknown: false, hops };
}
