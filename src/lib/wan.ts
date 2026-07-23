import type { UniFiDeviceHealth } from "./unifi";
import type { DesiredAlert } from "./alerts";

/**
 * Multi-WAN awareness. The site-health subsystems ("wan"/"www") describe the
 * ACTIVE uplink only, so on a dual-WAN gateway a dead backup link is invisible
 * — the Internet stays "ok" on the primary while the failover quietly rots.
 * These helpers read the gateway's per-interface state (`wan1`/`wan2` on
 * stat/device, plus the controller's per-WAN uptime monitors) to make both
 * links visible and alertable. Pure/testable, like the other evaluators.
 */

export type WanLink = {
  key: "wan1" | "wan2";
  name: string; // WAN network's friendly name, else the gateway's interface label, else WAN/WAN2
  up: boolean;
  enabled: boolean;
  active: boolean; // carries the site's traffic right now
  ip?: string;
  isp?: string;
  availability?: number; // % from the controller's uptime monitor
  latencyAvg?: number; // ms
  // Per-WAN speedtest, when the controller records it per interface. Mbps/ms.
  xputDown?: number;
  xputUp?: number;
  speedtestPing?: number;
  speedtestAt?: number; // epoch seconds of the last speedtest
};

const isGateway = (t?: string) => t === "udm" || t === "ugw" || t === "uxg";

/**
 * Per-WAN link state from the gateway device. `activeWanIp` (health "www"
 * wan_ip) marks which link is carrying traffic; with a single configured link
 * it is active whenever it's up. `networks` (the site's networkconf list, or
 * just its wan-purpose entries) supplies the operator's friendly WAN names —
 * the gateway's own `wan1.name` is the physical port label, which is what the
 * UI would otherwise show; `wan_networkgroup` ("WAN"/"WAN2") ties each
 * network to its interface.
 */
export function extractWanLinks(
  devices: Pick<UniFiDeviceHealth, "type" | "wan1" | "wan2" | "uptime_stats">[],
  activeWanIp?: string | null,
  networks?: { name: string; purpose?: string; wan_networkgroup?: string }[],
): WanLink[] {
  const gw = devices.find((d) => isGateway(d.type) && (d.wan1 || d.wan2));
  if (!gw) return [];

  const links: WanLink[] = [];
  const entries: ["wan1" | "wan2", string][] = [["wan1", "WAN"], ["wan2", "WAN2"]];
  for (const [key, monitorKey] of entries) {
    const w = gw[key];
    if (!w) continue; // interface not configured on this gateway
    const friendly = networks?.find(
      (n) => (n.purpose ?? "").startsWith("wan") && (n.wan_networkgroup ?? "WAN") === monitorKey,
    )?.name;
    const stats = gw.uptime_stats?.[monitorKey];
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    links.push({
      key,
      name: friendly || w.name || monitorKey,
      up: w.up === true,
      enabled: w.enable !== false,
      active: false, // resolved below
      ip: w.ip,
      isp: w.isp_name,
      availability: stats?.availability,
      latencyAvg: stats?.latency_average,
      xputDown: num(w.xput_down),
      xputUp: num(w.xput_up),
      speedtestPing: num(w.speedtest_ping),
      speedtestAt: num(w.speedtest_lastrun),
    });
  }

  const byIp = activeWanIp ? links.find((l) => l.ip && l.ip === activeWanIp) : undefined;
  if (byIp) byIp.active = true;
  else if (links.length === 1 && links[0].up) links[0].active = true;
  return links;
}

/**
 * One alert per enabled-but-down WAN link — the case the subsystem rule can't
 * see. Only meaningful with 2+ configured links (single-WAN outages are
 * already the "www"/"wan" subsystem alert; duplicating them here would
 * double-notify). Severity: warning while another link carries the site
 * (redundancy lost / failover active), error when nothing is up.
 */
export function evaluateWanLinkAlerts(links: WanLink[]): DesiredAlert[] {
  const enabled = links.filter((l) => l.enabled);
  // A disabled second interface is effectively single-WAN — and single-WAN
  // outages are the subsystem rule's job, so require 2+ *enabled* links.
  if (enabled.length < 2) return [];
  const anyUp = enabled.some((l) => l.up);
  const out: DesiredAlert[] = [];
  for (const l of enabled) {
    if (l.up) continue;
    const label = `${l.name}${l.isp ? ` (${l.isp})` : ""}`;
    out.push({
      target: `wanlink:${l.key}`,
      targetName: label,
      type: "wan_link",
      severity: anyUp ? "warning" : "error",
      message: anyUp
        ? `WAN link ${label} is down — the site is running on the remaining link (redundancy lost)`
        : `WAN link ${label} is down — no WAN link is up`,
      value: l.availability != null ? `${l.availability.toFixed(1)}% avail` : "down",
    });
  }
  return out;
}
