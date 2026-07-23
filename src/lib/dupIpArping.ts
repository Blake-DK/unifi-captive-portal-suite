import { getSshCredentials, runCommand } from "./deviceSsh";
import { listDevices } from "./unifi";
import { parseArpingResponders, type DupIpVerdict } from "./dupIp";

/**
 * Check (d): on-wire ARP validation for a duplicate-IP alarm the pure checks
 * couldn't decide. SSH to a device with an interface on the alarm's VLAN
 * (configured per VLAN in Settings → Monitoring; usually the gateway, whose
 * per-VLAN bridges are named br<vlan>) and count distinct responder MACs —
 * more than one is a genuine conflict. Bounded (`-c 3 -w 2`) and rate-limited
 * so an alarm storm can't hammer a switch; `ip neigh` is the fallback where
 * busybox lacks arping. Reuses the audited device-SSH tooling.
 */

// Per-IP cooldown + per-cycle budget: an alarm storm must not turn into an
// SSH storm. Both are process-local, like the UniFi session cache.
const ARPING_COOLDOWN_MS = 10 * 60 * 1000;
const lastProbeAt = new Map<string, number>();

export type ArpingResult = Pick<DupIpVerdict, "verdict" | "reasons">;

/**
 * Probe one IP via the mapped device. Returns null when the probe can't run
 * (no mapping for the VLAN, device unresolvable, cooldown, SSH failure) — the
 * caller must then treat the alarm as unverified, not suppressed.
 */
export async function arpingProbe(
  ip: string,
  vlan: number | undefined,
  map: Map<string, string>,
): Promise<ArpingResult | null> {
  const deviceMac = (vlan != null ? map.get(String(vlan)) : undefined) ?? map.get("*");
  if (!deviceMac) return null;

  const last = lastProbeAt.get(ip) ?? 0;
  if (Date.now() - last < ARPING_COOLDOWN_MS) return null;
  lastProbeAt.set(ip, Date.now());

  const device = (await listDevices().catch(() => [])).find(
    (d) => d.mac.toLowerCase() === deviceMac,
  );
  if (!device?.ip) return null;

  try {
    const creds = await getSshCredentials();
    const iface = vlan != null ? `br${vlan}` : "br0";
    // arping where available (interface-bound, counts replies), ip neigh as
    // the busybox fallback; output of both is parsed for responder MACs.
    const out = await runCommand(
      device.ip,
      creds,
      `arping -c 3 -w 2 -I ${iface} ${ip} 2>/dev/null; ip neigh show to ${ip} 2>/dev/null`,
      20_000,
    );
    const responders = parseArpingResponders(out, deviceMac);
    if (responders.length > 1) {
      return {
        verdict: "genuine",
        reasons: [`arping via ${device.name || deviceMac}: ${responders.length} distinct responders (${responders.join(", ")})`],
      };
    }
    return {
      verdict: "suppress",
      reasons: [`arping via ${device.name || deviceMac}: ${responders.length === 1 ? "a single responder" : "no responder"} for ${ip}`],
    };
  } catch (err) {
    console.error("arpingProbe failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
