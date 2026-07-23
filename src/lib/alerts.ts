import type { UniFiDeviceHealth, UniFiSubsystemHealth, UniFiStation } from "./unifi";
import { detectExtender } from "./rogueExtenders.ts"; // explicit extension so alerts.test.ts runs under Node's type-stripping runner

/**
 * Alert rule evaluation and notification rendering. Pure functions over the
 * controller snapshot so the poller stays a thin scheduler and the logic is
 * testable. Designed for large fleets: evaluation is O(devices × rules) in
 * memory and produces a flat desired-alert set the poller diffs against the
 * open alerts in one pass — no per-device DB round-trips.
 */

export type AlertType = "offline" | "cpu" | "mem" | "firmware" | "subsystem" | "saturation" | "port_err" | "rogue_extender" | "failed_login" | "rogue_ap" | "first_seen" | "dhcp_pool" | "duplicate_ip" | "wan_link" | "watched_client" | "controller_down" | "snmp_offline";
export type Severity = "error" | "warning";

export type DesiredAlert = {
  target: string; // device MAC or "subsystem:<name>"
  targetName: string;
  type: AlertType;
  severity: Severity;
  message: string;
  value?: string;
};

export type AlertConfig = {
  offline: boolean;
  cpuPct: number; // 0 = disabled
  memPct: number;
  firmware: boolean;
  subsystem: boolean;
  saturationPct: number; // switch-port link utilization %; 0 = disabled
  portErrPct: number; // switch-port error+discard ratio %; 0 = disabled
  rogueExtender: boolean; // suspected consumer WiFi extender/mesh node (high-confidence matches only)
};

// Ports below this lifetime packet count are too idle for the error ratio to be
// meaningful (a handful of errors on a near-silent port isn't a bad link).
const PORT_ERR_MIN_PACKETS = 100_000;

const DEVICE_STATE_LABEL: Record<number, string> = {
  0: "offline",
  2: "pending adoption",
  4: "upgrading",
  5: "provisioning",
  6: "heartbeat missed",
  7: "adopting",
  9: "adoption failed",
  10: "managed by other controller",
  11: "isolated",
};

const SUBSYSTEM_LABEL: Record<string, string> = {
  wlan: "WiFi",
  lan: "LAN",
  wan: "WAN",
  www: "Internet",
  vpn: "VPN",
};

/**
 * Failed-admin-login burst detection. Unlike the device rules this reads the
 * audit log, not the controller snapshot, so the poller passes the recent
 * `admin.login`/failure rows in. One alert per source IP that crossed the
 * threshold in the window; it self-clears once the burst ages out of the
 * window (the poller re-queries each cycle). Kept pure/testable like the rest.
 */
export function evaluateFailedLogins(
  rows: { ip: string | null; actor: string; createdAt: Date }[],
  opts: { threshold: number; windowMs: number; now?: number },
): DesiredAlert[] {
  if (opts.threshold <= 0) return [];
  const now = opts.now ?? Date.now();
  const cutoff = now - opts.windowMs;
  const byIp = new Map<string, { count: number; accounts: Set<string> }>();
  for (const r of rows) {
    if (r.createdAt.getTime() < cutoff) continue;
    const ip = r.ip || "unknown";
    const g = byIp.get(ip) ?? { count: 0, accounts: new Set<string>() };
    g.count += 1;
    if (r.actor) g.accounts.add(r.actor);
    byIp.set(ip, g);
  }
  const out: DesiredAlert[] = [];
  const mins = Math.round(opts.windowMs / 60_000);
  for (const [ip, g] of byIp) {
    if (g.count < opts.threshold) continue;
    const who = g.accounts.size ? ` (accounts: ${[...g.accounts].slice(0, 5).join(", ")})` : "";
    out.push({
      target: `login:${ip}`,
      targetName: ip,
      type: "failed_login",
      severity: "error",
      message: `${g.count} failed admin logins from ${ip} in ${mins} min${who}`,
      value: String(g.count),
    });
  }
  return out;
}

/**
 * Controller-outage watchdog. The poller counts consecutive cycles whose
 * controller snapshot failed outright and passes the streak in; every other
 * rule goes quiet during an outage (no snapshot to evaluate), so this is the
 * one alert that must fire exactly then, and the notify path (email/webhook)
 * does not depend on the controller. `alreadyOpen` keeps a restarted process
 * (streak reset to zero) refreshing an alert some earlier process opened
 * instead of re-waiting the threshold. Resolution needs no code here: the
 * first healthy cycle's diff clears the alert like any other.
 */
export function evaluateControllerDown(
  streak: number,
  opts: { enabled: boolean; threshold: number; alreadyOpen: boolean; errText?: string },
): DesiredAlert | null {
  if (!opts.enabled || streak <= 0) return null;
  if (streak < opts.threshold && !opts.alreadyOpen) return null;
  return {
    target: "controller",
    targetName: "UniFi controller",
    type: "controller_down",
    severity: "error",
    message: `UniFi controller unreachable for ${streak} consecutive poll cycle${streak !== 1 ? "s" : ""}${opts.errText ? ` (${opts.errText})` : ""}; device monitoring is blind until it recovers`,
    value: String(streak),
  };
}

/** Turn a controller snapshot into the set of alerts that SHOULD be open now. */
export function evaluateAlerts(
  devices: UniFiDeviceHealth[],
  health: UniFiSubsystemHealth[],
  stations: UniFiStation[],
  cfg: AlertConfig,
): DesiredAlert[] {
  const out: DesiredAlert[] = [];

  for (const d of devices) {
    const name = d.name || d.mac;
    if (cfg.offline && d.state !== 1) {
      out.push({
        target: d.mac,
        targetName: name,
        type: "offline",
        severity: "error",
        message: `${name} is ${DEVICE_STATE_LABEL[d.state ?? -1] ?? `in state ${d.state}`}`,
        value: DEVICE_STATE_LABEL[d.state ?? -1] ?? String(d.state),
      });
    }
    // Resource pressure only makes sense on an online device.
    if (d.state === 1) {
      const ss = d["system-stats"] ?? {};
      const cpu = Number(ss.cpu);
      const mem = Number(ss.mem);
      if (cfg.cpuPct > 0 && Number.isFinite(cpu) && cpu >= cfg.cpuPct) {
        out.push({ target: d.mac, targetName: name, type: "cpu", severity: "warning", message: `${name} CPU at ${cpu.toFixed(0)}%`, value: `${cpu.toFixed(0)}%` });
      }
      if (cfg.memPct > 0 && Number.isFinite(mem) && mem >= cfg.memPct) {
        out.push({ target: d.mac, targetName: name, type: "mem", severity: "warning", message: `${name} memory at ${mem.toFixed(0)}%`, value: `${mem.toFixed(0)}%` });
      }
    }
    if (cfg.firmware && d.upgradable) {
      out.push({ target: d.mac, targetName: name, type: "firmware", severity: "warning", message: `${name} has a firmware update available`, value: d.version });
    }
    // Switch-port health (saturation + interface errors) — only on an online
    // device with a port table. `target` is per-port so one bad port doesn't
    // mask another and recovery clears independently.
    if (d.state === 1 && (cfg.saturationPct > 0 || cfg.portErrPct > 0) && Array.isArray(d.port_table)) {
      for (const p of d.port_table) {
        if (!p.up || p.enable === false || p.port_idx == null) continue;
        const portName = p.name ? `${p.name} (port ${p.port_idx})` : `port ${p.port_idx}`;
        const label = `${name} ${portName}`;

        if (cfg.saturationPct > 0) {
          const speed = Number(p.speed); // negotiated Mbps
          const rate = Math.max(Number(p["rx_bytes-r"]) || 0, Number(p["tx_bytes-r"]) || 0);
          if (Number.isFinite(speed) && speed > 0 && rate > 0) {
            const pct = ((rate * 8) / (speed * 1e6)) * 100; // bytes/s -> Mbps vs link speed
            if (pct >= cfg.saturationPct) {
              out.push({
                target: `port:${d.mac}:${p.port_idx}`,
                targetName: label,
                type: "saturation",
                severity: "warning",
                message: `${label} at ${pct.toFixed(0)}% of ${speed >= 1000 ? `${speed / 1000}G` : `${speed}M`} link`,
                value: `${pct.toFixed(0)}%`,
              });
            }
          }
        }

        if (cfg.portErrPct > 0) {
          const errs = (Number(p.rx_errors) || 0) + (Number(p.tx_errors) || 0) + (Number(p.rx_dropped) || 0) + (Number(p.tx_dropped) || 0);
          const pkts = (Number(p.rx_packets) || 0) + (Number(p.tx_packets) || 0);
          if (pkts >= PORT_ERR_MIN_PACKETS && errs > 0) {
            const ratio = (errs / (errs + pkts)) * 100;
            if (ratio >= cfg.portErrPct) {
              out.push({
                target: `porterr:${d.mac}:${p.port_idx}`,
                targetName: label,
                type: "port_err",
                severity: "warning",
                message: `${label} error/discard ratio ${ratio.toFixed(2)}% (${errs.toLocaleString()} of ${(errs + pkts).toLocaleString()})`,
                value: `${ratio.toFixed(2)}%`,
              });
            }
          }
        }
      }
    }
  }

  // Rogue extender/mesh-node detection — only high-confidence matches (a
  // hostname/model-number hit) open an alert; OUI-only matches are prone to
  // false positives and stay visibility-only on the Clients page.
  if (cfg.rogueExtender) {
    for (const sta of stations) {
      const match = detectExtender({ mac: sta.mac, hostname: sta.hostname, name: sta.name });
      if (!match || match.confidence !== "high") continue;
      const label = sta.name || sta.hostname || sta.mac;
      out.push({
        target: sta.mac.toLowerCase(),
        targetName: label,
        type: "rogue_extender",
        severity: "warning",
        message: `${label} looks like a consumer WiFi extender/mesh node (${match.reason})${match.vendor ? ` — ${match.vendor}` : ""}`,
        value: match.vendor ?? match.reason,
      });
    }
  }

  if (cfg.subsystem) {
    for (const h of health) {
      const label = SUBSYSTEM_LABEL[h.subsystem] ?? h.subsystem;
      const bad = h.status && h.status !== "ok" && h.status !== "unknown";
      const disconnected = (h.num_disconnected ?? 0) > 0;
      if (bad || disconnected) {
        out.push({
          target: `subsystem:${h.subsystem}`,
          targetName: `${label} subsystem`,
          type: "subsystem",
          severity: h.status === "error" || disconnected ? "error" : "warning",
          message: disconnected
            ? `${label}: ${h.num_disconnected} device(s) disconnected`
            : `${label} subsystem reports ${h.status}`,
          value: h.status,
        });
      }
    }
  }

  return out;
}

export const alertKey = (a: { target: string; type: string }) => `${a.target}::${a.type}`;

/** A notification batch: everything that transitioned this poll cycle. */
export type AlertTransition = { targetName: string; type: AlertType; severity: Severity; message: string };

export function renderAlertEmail(
  firing: AlertTransition[],
  resolved: AlertTransition[],
  opts: { brand: string; url?: string },
): { subject: string; html: string; text: string } {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const errors = firing.filter((f) => f.severity === "error").length;
  const subject =
    firing.length > 0
      ? `[${opts.brand}] ${firing.length} network alert${firing.length !== 1 ? "s" : ""}${errors ? ` (${errors} critical)` : ""}`
      : `[${opts.brand}] ${resolved.length} alert${resolved.length !== 1 ? "s" : ""} resolved`;

  const list = (items: AlertTransition[]) =>
    items.map((i) => `<li>${i.severity === "error" ? "🔴" : "🟠"} ${esc(i.message)}</li>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#18181b">
${firing.length ? `<p><strong>Firing (${firing.length}):</strong></p><ul>${list(firing)}</ul>` : ""}
${resolved.length ? `<p><strong>Resolved (${resolved.length}):</strong></p><ul>${list(resolved)}</ul>` : ""}
${opts.url ? `<p><a href="${opts.url}/admin/alerts">Open the alerts page</a></p>` : ""}
</div>`;

  const textList = (items: AlertTransition[]) => items.map((i) => `  - ${i.message}`).join("\n");
  const text = [
    firing.length ? `Firing (${firing.length}):\n${textList(firing)}` : "",
    resolved.length ? `Resolved (${resolved.length}):\n${textList(resolved)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject, html, text };
}

/** Generic webhook payload — works with Slack/Discord/ntfy-style consumers that accept `text`. */
export function renderWebhookPayload(firing: AlertTransition[], resolved: AlertTransition[], brand: string) {
  const lines = [
    ...firing.map((f) => `${f.severity === "error" ? "🔴" : "🟠"} FIRING: ${f.message}`),
    ...resolved.map((r) => `🟢 RESOLVED: ${r.message}`),
  ];
  return {
    text: `*${brand} network alerts*\n${lines.join("\n")}`,
    firing,
    resolved,
    at: new Date().toISOString(),
  };
}
