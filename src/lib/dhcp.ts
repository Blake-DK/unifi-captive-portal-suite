import type { UniFiNetwork, UniFiStation } from "./unifi";
import type { DesiredAlert } from "./alerts";

/**
 * DHCP pool-exhaustion analysis. A full guest pool is a classic "guests can't
 * connect" root cause that nothing else here catches. We can't read the
 * controller's lease table directly, so pool usage is approximated by counting
 * currently-connected clients whose IP falls inside each network's DHCP range —
 * a good proxy for active leases. Pure/testable so the status page and the
 * alert rule share one definition.
 */

export type DhcpPoolUsage = {
  network: string;
  subnet?: string;
  start: string;
  stop: string;
  size: number; // addresses in the pool
  used: number; // connected clients within the range
  pct: number; // 0–100
};

function ipToInt(ip?: string): number | null {
  if (!ip) return null;
  const p = ip.trim().split(".");
  if (p.length !== 4) return null;
  const nums = p.map((x) => Number(x));
  if (nums.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return nums[0] * 2 ** 24 + nums[1] * 2 ** 16 + nums[2] * 256 + nums[3];
}

export function dhcpPoolUsage(
  networks: UniFiNetwork[],
  stations: UniFiStation[],
): DhcpPoolUsage[] {
  const stationIps = stations.map((s) => ipToInt(s.ip)).filter((n): n is number => n != null);
  const out: DhcpPoolUsage[] = [];
  for (const net of networks) {
    if (!net.dhcpd_enabled) continue;
    const start = ipToInt(net.dhcpd_start);
    const stop = ipToInt(net.dhcpd_stop);
    if (start == null || stop == null || stop < start) continue;
    const size = stop - start + 1;
    const used = stationIps.filter((ip) => ip >= start && ip <= stop).length;
    out.push({
      network: net.name,
      subnet: net.ip_subnet,
      start: net.dhcpd_start!,
      stop: net.dhcpd_stop!,
      size,
      used,
      pct: size > 0 ? Math.min(100, (used / size) * 100) : 0,
    });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

/** One alert per network whose pool is at/above the threshold %. */
export function evaluateDhcpAlerts(usage: DhcpPoolUsage[], thresholdPct: number): DesiredAlert[] {
  if (thresholdPct <= 0) return [];
  const out: DesiredAlert[] = [];
  for (const u of usage) {
    if (u.pct < thresholdPct) continue;
    out.push({
      target: `dhcp:${u.network}`,
      targetName: `${u.network} DHCP pool`,
      type: "dhcp_pool",
      severity: u.pct >= 95 ? "error" : "warning",
      message: `${u.network} DHCP pool ${u.pct.toFixed(0)}% used (${u.used}/${u.size} in ${u.start}–${u.stop})`,
      value: `${u.pct.toFixed(0)}%`,
    });
  }
  return out;
}
