import { decryptSecret } from "./secrets.ts"; // explicit extension so snmpFallback.test.ts runs under Node's type-stripping runner
import { sweepTargets, type SnmpCreds, type SnmpProbeResult } from "./snmp.ts";
import type { DesiredAlert } from "./alerts.ts";

/**
 * Degraded-mode reachability, used only while the controller itself is down
 * (see the controller_down watchdog in alertMonitor.ts). Cached target list
 * (SnmpTarget) + SNMPv3 credentials in Settings -> Monitoring. Deliberately
 * narrow: a reachability signal, not a replacement for the controller's own
 * richer device health.
 */

export type SnmpTargetLite = { mac: string; ip: string; name: string; type?: string | null };

/**
 * A gateway's `ip` in stat/device is often its WAN-facing address, not a LAN
 * management IP — polling that from the LAN side means hairpinning out to
 * the site's own public IP over the internet, which times out on most
 * routers regardless of whether SNMP is even listening there (confirmed
 * live 2026-07-15: the gateway's reported IP was a public address and
 * timed out while a switch on a private IP answered fine with the same
 * credentials). Only private/link-local addresses are worth polling for
 * this fallback's purpose.
 */
export function hasPollableIp(ip: string | undefined): ip is string {
  if (!ip) return false;
  const o = ip.trim().split(".").map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return (
    o[0] === 10 ||
    (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
    (o[0] === 192 && o[1] === 168) ||
    (o[0] === 169 && o[1] === 254) ||
    o[0] === 127
  );
}

export type SnmpSettingsLite = {
  snmpUser: string;
  snmpAuthKey: string;
  snmpPrivKey: string;
  snmpAuthProtocol: string;
  snmpPrivProtocol: string;
  snmpPort: number;
};

export function credsFromSettings(s: SnmpSettingsLite): SnmpCreds {
  return {
    user: s.snmpUser,
    authKey: decryptSecret(s.snmpAuthKey),
    privKey: decryptSecret(s.snmpPrivKey),
    authProtocol: s.snmpAuthProtocol,
    privProtocol: s.snmpPrivProtocol,
    port: s.snmpPort,
  };
}

/**
 * A representative sample for the "Test SNMP now" button and the daily
 * canary: one gateway, one AP, one switch when the types are known, else the
 * first three targets. Small and fast — proves credentials/reachability
 * without sweeping the whole fleet outside an actual outage.
 */
export function pickSample(targets: SnmpTargetLite[], limit = 3): SnmpTargetLite[] {
  const gw = targets.find((t) => t.type && ["udm", "ugw", "uxg"].includes(t.type));
  const ap = targets.find((t) => t.type === "uap");
  const sw = targets.find((t) => t.type === "usw");
  const picked = [gw, ap, sw].filter((t): t is SnmpTargetLite => !!t);
  for (const t of targets) {
    if (picked.length >= limit) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked.slice(0, limit);
}

/** Network I/O: sweep the given targets and report per-target reachability. */
export function runSweep(targets: SnmpTargetLite[], creds: SnmpCreds): Promise<SnmpProbeResult[]> {
  return sweepTargets(targets, creds);
}

/**
 * Pure: turn a sweep's results into the snmp_offline alerts that should be
 * open right now. Distinct alert type from `offline` (controller-derived) —
 * the frozen controller-derived alerts stay untouched during an outage, and
 * the first healthy cycle's normal diff clears every snmp_offline alert
 * automatically since this type is never in that cycle's desired set.
 */
export function evaluateSnmpSweep(targets: SnmpTargetLite[], results: SnmpProbeResult[]): DesiredAlert[] {
  const unreachable = new Set(results.filter((r) => !r.reachable).map((r) => r.mac));
  const out: DesiredAlert[] = [];
  for (const t of targets) {
    if (!unreachable.has(t.mac)) continue;
    out.push({
      target: t.mac,
      targetName: t.name,
      type: "snmp_offline",
      severity: "error",
      message: `${t.name} unreachable via SNMP (controller down — reduced-fidelity check)`,
      value: t.ip,
    });
  }
  return out;
}

/** One-line summary for the controller_down alert's message/value and the dashboard banner. */
export function summarize(targets: SnmpTargetLite[], results: SnmpProbeResult[]): string {
  const reachable = results.filter((r) => r.reachable).length;
  return `${reachable}/${targets.length} devices answering via SNMP`;
}

/**
 * Daily canary (controller healthy, no outage in progress): a small sample
 * fails only if the SNMP credentials/reachability themselves are broken, so
 * that's discovered before an actual outage, not during one. A single device
 * being down for an unrelated reason must not trip this — it fires only when
 * every sampled target is unreachable.
 */
export function evaluateCanary(sample: SnmpTargetLite[], results: SnmpProbeResult[]): DesiredAlert | null {
  if (sample.length === 0) return null;
  const allDown = results.every((r) => !r.reachable);
  if (!allDown) return null;
  const firstError = results.find((r) => r.error)?.error;
  return {
    target: "snmp:canary",
    targetName: "SNMP fallback canary",
    type: "snmp_offline",
    severity: "warning",
    message: `SNMP fallback canary: all ${sample.length} sampled devices unreachable — check credentials/network before an outage needs this fallback${firstError ? ` (${firstError})` : ""}`,
    value: String(sample.length),
  };
}
