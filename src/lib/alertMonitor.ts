import { prisma } from "./prisma";
import { auditSystem } from "./audit";
import { withRetries } from "./notifyRetry";
import { getSiteHealth, listDevices, listNetworks, listRogueAps, listStations, listWlans, type UniFiDeviceHealth } from "./unifi";
import { applyDeviceIgnores } from "./ignoredDevices";
import { getMailSettings, isMailConfigured, sendMail } from "./mailer";
import {
  alertKey,
  evaluateAlerts,
  evaluateControllerDown,
  evaluateFailedLogins,
  renderAlertEmail,
  renderWebhookPayload,
  type AlertTransition,
  type DesiredAlert,
} from "./alerts";
import { evaluateRogueApAlerts, ourSsidSet } from "./rogueAps";
import { dhcpPoolUsage, evaluateDhcpAlerts } from "./dhcp";
import { runDupIpGate } from "./dupIpMonitor";
import { evaluateWanLinkAlerts, extractWanLinks } from "./wan";
import {
  credsFromSettings,
  evaluateCanary,
  evaluateSnmpSweep,
  hasPollableIp,
  pickSample,
  runSweep,
  summarize,
  type SnmpTargetLite,
} from "./snmpFallback";

// DHCP pool exhaustion alert threshold (% of the pool in use). Constant for a
// first version, like the other audit/scan-derived rules.
const DHCP_POOL_ALERT_PCT = 90;

/**
 * Background alert monitor. Each cycle: one controller snapshot -> evaluate
 * rules -> diff against the currently-open alerts -> write only the
 * transitions (new firing, still-firing lastSeen bump, newly resolved) ->
 * send ONE batched email + ONE webhook for everything that changed. This
 * keeps steady-state cost near zero and prevents alert storms when a switch
 * takes 50 downstream devices offline at once. Single-container timer, like
 * the retention and expiry schedulers.
 */

export type AlertRunStats = { firing: number; resolved: number; open: number; notified: boolean; skipped?: string };

// Consecutive cycles whose controller snapshot failed, feeding the
// controller_down watchdog. Process-local: the scheduler lock keeps one timer,
// and a "Check now" / webhook-triggered cycle in another process converges via
// the open-alert row check in handleControllerOutage.
let unreachableStreak = 0;

// Last-written SnmpTarget state, so a steady-state fleet costs zero upserts.
// null until the first healthy cycle after process start reads it from the
// DB — a restart doesn't force a full re-upsert wave.
let snmpTargetCache: Map<string, { ip: string; name: string; model: string | null; type: string | null }> | null = null;
let lastSnmpCanaryAt = 0;
const SNMP_CANARY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function runAlertCycle(): Promise<AlertRunStats | null> {
  const s = await prisma.systemSettings.findUnique({ where: { id: "config" } });
  if (!s?.alertsEnabled) return null;

  let devices, health, stations;
  try {
    [devices, health, stations] = await Promise.all([
      listDevices(),
      getSiteHealth().catch(() => []),
      listStations().catch(() => []),
    ]);
  } catch (err) {
    // Controller unreachable: don't flap every device to "resolved", the
    // device rules freeze. The outage itself is the one thing still worth
    // alerting on (email/webhook need no controller), so it feeds a watchdog
    // instead of returning silently.
    unreachableStreak += 1;
    return handleControllerOutage(s, err);
  }
  unreachableStreak = 0;

  // Devices the operator ignored while they are offline (decommissioned gear)
  // raise no alerts. The sweep lifts the ignore when one comes back online, so
  // returning hardware is monitored again from that moment. The controller's
  // health counts them too, so a subsystem alert needs the same subtraction.
  ({ devices, health } = await applyDeviceIgnores(devices, health));

  // SNMP fallback target cache: only maintained while the feature is on
  // (an outage with an empty cache just can't fall back, no false alarms) —
  // upserts only on change so a steady-state fleet costs nothing.
  if (s.snmpEnabled) {
    try {
      await syncSnmpTargets(devices);
    } catch (err) {
      console.error("SNMP target sync failed:", err);
    }
  }

  const desired = evaluateAlerts(devices, health, stations, {
    offline: s.alertOfflineEnabled,
    cpuPct: s.alertCpuPct,
    memPct: s.alertMemPct,
    firmware: s.alertFirmwareEnabled,
    subsystem: s.alertSubsystemEnabled,
    saturationPct: s.alertSaturationPct,
    portErrPct: s.alertPortErrPct,
    rogueExtender: s.alertRogueExtenderEnabled,
  });
  // Per-WAN-link health on multi-WAN gateways: the subsystem rule above only
  // sees the ACTIVE uplink, so a dead backup link would otherwise stay
  // invisible until the failover is needed. Same toggle as the subsystem rule
  // (it's the same concern at finer grain).
  if (s.alertSubsystemEnabled) {
    const www = health.find((h) => h.subsystem === "www");
    // Networks only supply the friendly WAN names — best-effort.
    const networks = await listNetworks().catch(() => []);
    desired.push(...evaluateWanLinkAlerts(extractWanLinks(devices, www?.wan_ip, networks)));
  }
  // Failed-admin-login bursts come from the audit log, not the controller, so
  // they're evaluated here and merged into the same desired set. Only the
  // recent window is queried, keyed by source IP.
  const loginRows = await prisma.auditLog.findMany({
    where: {
      action: "admin.login",
      outcome: "failure",
      // Thresholds live in Settings → Monitoring (0 count disables the rule).
      createdAt: { gte: new Date(Date.now() - s.alertFailedLoginWindowMin * 60_000) },
    },
    select: { ip: true, actor: true, createdAt: true },
  });
  // Rogue/evil-twin APs: neighbours broadcasting one of our SSIDs. Own fetch
  // (scan data + our WLAN list), best-effort — a failure here must not sink the
  // whole cycle, so it's caught and skipped.
  try {
    const [rogues, wlans] = await Promise.all([listRogueAps(), listWlans()]);
    desired.push(...evaluateRogueApAlerts(rogues, ourSsidSet(wlans.map((w) => w.name))));
  } catch (err) {
    console.error("Rogue-AP evaluation failed:", err);
  }
  // DHCP pool exhaustion (per network), best-effort.
  try {
    const networks = await listNetworks();
    desired.push(...evaluateDhcpAlerts(dhcpPoolUsage(networks, stations), DHCP_POOL_ALERT_PCT));
  } catch (err) {
    console.error("DHCP-pool evaluation failed:", err);
  }
  // Duplicate-IP suppression gate: classify the controller's duplicate-IP
  // alarms, alert only on genuine conflicts, log the rest to SuppressedAlert.
  // Best-effort like the other alarm-derived rules.
  if (s.dupIpEnabled) {
    try {
      const gate = await runDupIpGate(s, stations);
      desired.push(...gate.desired);
    } catch (err) {
      console.error("Duplicate-IP evaluation failed:", err);
    }
  }
  desired.push(
    ...evaluateFailedLogins(loginRows, {
      threshold: s.alertFailedLoginCount,
      windowMs: s.alertFailedLoginWindowMin * 60_000,
    }),
  );

  // Watchlist (Catalyst's client tracking): a watched_client alert is open
  // while the client is associated, so the connect fires a notification and
  // the disconnect resolves it. Expired watches are swept here.
  try {
    const watches = await prisma.watchedClient.findMany();
    const now = Date.now();
    const expired = watches.filter((w) => w.expiresAt && w.expiresAt.getTime() < now);
    if (expired.length > 0) {
      await prisma.watchedClient.deleteMany({ where: { mac: { in: expired.map((w) => w.mac) } } });
    }
    const live = new Map(stations.map((st) => [st.mac.toLowerCase(), st]));
    for (const w of watches) {
      if (w.expiresAt && w.expiresAt.getTime() < now) continue;
      const sta = live.get(w.mac);
      if (!sta) continue;
      const label = sta.name || sta.hostname || w.mac;
      desired.push({
        target: `watch:${w.mac}`,
        targetName: label,
        type: "watched_client",
        severity: "warning",
        message: `Watched client connected: ${label} (${w.mac})${sta.ip ? ` @ ${sta.ip}` : ""}${w.note ? ` — ${w.note}` : ""}`,
        value: w.mac,
      });
    }
  } catch (err) {
    console.error("Watchlist evaluation failed:", err);
  }

  // First-seen device tracking. The seen-MAC table is maintained EVERY cycle
  // (even when the alert is off), so enabling the alert later doesn't flag the
  // whole existing fleet — only MACs that appear after the baseline settles.
  // A MAC is "new" if it wasn't in the table before this cycle's upsert; we
  // only alert when the table already had a baseline (>0 rows), so the very
  // first run after the migration seeds silently.
  const stationMacs = [...new Set(stations.map((s) => s.mac.toLowerCase()))];
  if (stationMacs.length > 0) {
    const seenAt = new Date();
    const baseline = await prisma.seenDevice.count();
    const known = new Set(
      (
        await prisma.seenDevice.findMany({
          where: { mac: { in: stationMacs } },
          select: { mac: true },
        })
      ).map((k) => k.mac),
    );
    for (const sta of stations) {
      const mac = sta.mac.toLowerCase();
      const hostname = sta.name ?? sta.hostname ?? null;
      await prisma.seenDevice.upsert({
        where: { mac },
        create: { mac, hostname },
        update: { lastSeenAt: seenAt, hostname: hostname ?? undefined },
      });
    }
    if (s.alertFirstSeenEnabled && baseline > 0) {
      for (const sta of stations) {
        const mac = sta.mac.toLowerCase();
        if (known.has(mac)) continue; // already seen before this cycle
        const label = sta.name || sta.hostname || mac;
        desired.push({
          target: `firstseen:${mac}`,
          targetName: label,
          type: "first_seen",
          severity: "warning",
          message: `New device first seen: ${label} (${mac})${sta.ip ? ` @ ${sta.ip}` : ""}`,
          value: mac,
        });
      }
    }
  }

  // SNMP fallback canary: proves credentials/reachability work BEFORE an
  // outage needs them, at most once/24h, against a small sample. Fires only
  // when every sampled target is unreachable (one device being down for an
  // unrelated reason must not trip it).
  if (s.snmpEnabled && Date.now() - lastSnmpCanaryAt > SNMP_CANARY_INTERVAL_MS) {
    lastSnmpCanaryAt = Date.now();
    try {
      const liteTargets: SnmpTargetLite[] = devices
        .filter((d) => hasPollableIp(d.ip))
        .map((d) => ({ mac: d.mac.toLowerCase(), ip: d.ip!, name: d.name || d.mac, type: d.type }));
      const sample = pickSample(liteTargets);
      if (sample.length > 0) {
        const results = await runSweep(sample, credsFromSettings(s));
        const canary = evaluateCanary(sample, results);
        if (canary) desired.push(canary);
      }
    } catch (err) {
      console.error("SNMP canary failed:", err);
    }
  }

  const desiredByKey = new Map<string, DesiredAlert>(desired.map((d) => [alertKey(d), d]));

  const open = await prisma.alert.findMany({ where: { resolvedAt: null } });
  const openByKey = new Map(open.map((a) => [alertKey(a), a]));

  const now = new Date();
  const firing: AlertTransition[] = [];
  const resolved: AlertTransition[] = [];

  // New + continuing alerts.
  for (const [key, d] of desiredByKey) {
    const existing = openByKey.get(key);
    if (!existing) {
      await prisma.alert.create({
        data: {
          target: d.target,
          targetName: d.targetName,
          type: d.type,
          severity: d.severity,
          message: d.message,
          value: d.value ?? null,
          notifiedFiring: false,
        },
      });
      firing.push({ targetName: d.targetName, type: d.type, severity: d.severity, message: d.message });
    } else {
      // Still firing — refresh lastSeen (and message/value if they drifted).
      await prisma.alert.update({
        where: { id: existing.id },
        data: { lastSeenAt: now, message: d.message, value: d.value ?? null, severity: d.severity },
      });
    }
  }

  // Cleared alerts.
  for (const [key, a] of openByKey) {
    if (!desiredByKey.has(key)) {
      // "first_seen" is a one-shot event (a device appeared), not a condition
      // that recovers — mark it resolved+notified so it silently ages out
      // without sending a "recovered" notice.
      const isEvent = a.type === "first_seen";
      await prisma.alert.update({
        where: { id: a.id },
        data: { resolvedAt: now, notifiedResolved: isEvent },
      });
      if (!isEvent) {
        resolved.push({ targetName: a.targetName, type: a.type as AlertTransition["type"], severity: a.severity as AlertTransition["severity"], message: `${a.targetName}: recovered (${a.message})` });
      }
    }
  }

  let notified = false;
  if (firing.length > 0 || resolved.length > 0) {
    notified = await notify(s, firing, resolved);
    // Mark what we just notified so a later cycle doesn't repeat it.
    if (notified) {
      await prisma.alert.updateMany({ where: { resolvedAt: null, notifiedFiring: false }, data: { notifiedFiring: true } });
      await prisma.alert.updateMany({ where: { resolvedAt: { not: null }, notifiedResolved: false }, data: { notifiedResolved: true } });
    }
    await auditSystem({
      actorType: "admin",
      actor: "scheduler",
      action: "alert.transition",
      detail: { firing: firing.length, resolved: resolved.length, notified },
      outcome: "success",
    });
  }

  const openCount = await prisma.alert.count({ where: { resolvedAt: null } });
  return { firing: firing.length, resolved: resolved.length, open: openCount, notified };
}

type OutageSettings = {
  alertControllerDownEnabled: boolean;
  alertControllerDownCycles: number;
  alertEmail: string;
  alertWebhookUrl: string;
  brandName: string;
  adminBaseUrl: string;
  portalBaseUrl: string;
  snmpEnabled: boolean;
  snmpUser: string;
  snmpAuthKey: string;
  snmpPrivKey: string;
  snmpAuthProtocol: string;
  snmpPrivProtocol: string;
  snmpPort: number;
};

/**
 * The controller snapshot failed this cycle. Open (or refresh) the
 * controller_down alert once the streak crosses the configured threshold;
 * the open-row check means a process restart mid-outage refreshes the
 * existing alert instead of re-waiting the threshold, and never re-notifies.
 * Resolution is free: the first healthy cycle's diff (the cleared-alerts loop
 * in runAlertCycle) sees no desired controller_down and sends "recovered".
 *
 * Once the alert is actually open (not on a single blip), and SNMP fallback
 * is configured, this also sweeps the cached device list over SNMP and
 * carries snmp_offline alerts through the SAME notify batch — one digest for
 * the whole outage, not two.
 */
async function handleControllerOutage(s: OutageSettings, err: unknown): Promise<AlertRunStats> {
  const firing: AlertTransition[] = [];
  const resolved: AlertTransition[] = [];
  let notified = false;
  try {
    const already = await prisma.alert.findFirst({ where: { type: "controller_down", resolvedAt: null } });
    const desired = evaluateControllerDown(unreachableStreak, {
      enabled: s.alertControllerDownEnabled,
      threshold: s.alertControllerDownCycles,
      alreadyOpen: !!already,
      errText: err instanceof Error ? err.message : undefined,
    });

    let message = desired?.message ?? "";
    if (desired && s.snmpEnabled) {
      try {
        const rows = await prisma.snmpTarget.findMany();
        if (rows.length > 0) {
          const targets: SnmpTargetLite[] = rows.map((r) => ({ mac: r.mac, ip: r.ip, name: r.name, type: r.type }));
          const results = await runSweep(targets, credsFromSettings(s));
          message += ` — SNMP fallback: ${summarize(targets, results)}`;

          const snmpDesired = evaluateSnmpSweep(targets, results);
          const snmpDesiredByKey = new Map(snmpDesired.map((d) => [alertKey(d), d]));
          const snmpOpen = await prisma.alert.findMany({ where: { type: "snmp_offline", resolvedAt: null } });
          const snmpOpenByKey = new Map(snmpOpen.map((a) => [alertKey(a), a]));
          const now = new Date();
          for (const [key, d] of snmpDesiredByKey) {
            const existing = snmpOpenByKey.get(key);
            if (!existing) {
              await prisma.alert.create({
                data: { target: d.target, targetName: d.targetName, type: d.type, severity: d.severity, message: d.message, value: d.value ?? null, notifiedFiring: false },
              });
              firing.push({ targetName: d.targetName, type: d.type, severity: d.severity, message: d.message });
            } else {
              await prisma.alert.update({ where: { id: existing.id }, data: { lastSeenAt: now, message: d.message, value: d.value ?? null } });
            }
          }
          for (const [key, a] of snmpOpenByKey) {
            if (snmpDesiredByKey.has(key)) continue;
            await prisma.alert.update({ where: { id: a.id }, data: { resolvedAt: now } });
            resolved.push({ targetName: a.targetName, type: "snmp_offline", severity: a.severity as AlertTransition["severity"], message: `${a.targetName}: recovered (${a.message})` });
          }
        }
      } catch (e) {
        // SNMP is a best-effort fallback — its failure must not stop the
        // controller_down alert itself from opening/refreshing.
        console.error("SNMP fallback sweep failed:", e);
      }
    }

    if (desired && already) {
      await prisma.alert.update({
        where: { id: already.id },
        data: { lastSeenAt: new Date(), message, value: desired.value ?? null },
      });
    } else if (desired) {
      await prisma.alert.create({
        data: {
          target: desired.target,
          targetName: desired.targetName,
          type: desired.type,
          severity: desired.severity,
          message,
          value: desired.value ?? null,
          notifiedFiring: false,
        },
      });
      firing.unshift({ targetName: desired.targetName, type: desired.type, severity: desired.severity, message });
    }

    if (firing.length > 0 || resolved.length > 0) {
      notified = await notify(s, firing, resolved);
      if (notified) {
        await prisma.alert.updateMany({
          where: { resolvedAt: null, notifiedFiring: false, type: { in: ["controller_down", "snmp_offline"] } },
          data: { notifiedFiring: true },
        });
        await prisma.alert.updateMany({
          where: { resolvedAt: { not: null }, notifiedResolved: false, type: "snmp_offline" },
          data: { notifiedResolved: true },
        });
      }
      await auditSystem({
        actorType: "admin",
        actor: "scheduler",
        action: "alert.transition",
        detail: { firing: firing.length, resolved: resolved.length, notified, controllerDown: true },
        outcome: "success",
      });
    }
  } catch (e) {
    // The DB is a separate dependency — its failure must not throw out of the
    // poll loop on top of the controller outage.
    console.error("Controller-outage watchdog failed:", e);
  }
  const open = await prisma.alert.count({ where: { resolvedAt: null } }).catch(() => 0);
  return { firing: firing.length, resolved: resolved.length, open, notified, skipped: "controller unreachable" };
}

/**
 * Keeps SnmpTarget in step with the adopted infra fleet: upserts only rows
 * that actually changed (steady state costs zero writes) and prunes MACs no
 * longer present (a de-adopted device must not linger as a phantom
 * "unreachable" target in every future outage).
 */
async function syncSnmpTargets(devices: UniFiDeviceHealth[]): Promise<void> {
  if (snmpTargetCache === null) {
    const rows = await prisma.snmpTarget.findMany();
    snmpTargetCache = new Map(rows.map((r) => [r.mac, { ip: r.ip, name: r.name, model: r.model, type: r.type }]));
  }
  const seen = new Set<string>();
  for (const d of devices) {
    // Gateways in particular often report a WAN (public) address here —
    // unreachable via SNMP from the LAN side regardless of credentials.
    if (!d.mac || !hasPollableIp(d.ip)) continue;
    const mac = d.mac.toLowerCase();
    seen.add(mac);
    const next = { ip: d.ip, name: d.name || d.mac, model: d.model ?? null, type: d.type ?? null };
    const prev = snmpTargetCache.get(mac);
    if (prev && prev.ip === next.ip && prev.name === next.name && prev.model === next.model && prev.type === next.type) continue;
    await prisma.snmpTarget.upsert({ where: { mac }, create: { mac, ...next }, update: next });
    snmpTargetCache.set(mac, next);
  }
  const stale = [...snmpTargetCache.keys()].filter((m) => !seen.has(m));
  if (stale.length > 0) {
    await prisma.snmpTarget.deleteMany({ where: { mac: { in: stale } } });
    for (const m of stale) snmpTargetCache.delete(m);
  }
}

async function notify(
  s: { alertEmail: string; alertWebhookUrl: string; brandName: string; adminBaseUrl: string; portalBaseUrl: string },
  firing: AlertTransition[],
  resolved: AlertTransition[],
): Promise<boolean> {
  let sent = false;
  const brand = s.brandName || "Network";
  const url = (s.adminBaseUrl || s.portalBaseUrl || "").replace(/\/+$/, "") || undefined;

  // A transient SMTP/webhook failure gets bounded retries; exhausting them
  // writes a dead-letter audit entry so the drop is an event, not a silence.
  const deadLetter = async (channel: string, target: string, r: { attempts: number; lastError?: string }) => {
    console.error(`Alert ${channel} failed after ${r.attempts} attempt(s):`, r.lastError);
    await auditSystem({
      actorType: "system",
      actor: "alert-monitor",
      action: "alert.notify_deadletter",
      target,
      detail: { channel, attempts: r.attempts, error: r.lastError ?? "", firing: firing.length, resolved: resolved.length },
      outcome: "failure",
    });
  };

  // Email — one digest, via the existing SMTP settings.
  if (s.alertEmail) {
    const mail = await getMailSettings();
    if (isMailConfigured(mail)) {
      const { subject, html, text } = renderAlertEmail(firing, resolved, { brand, url });
      const r = await withRetries(() =>
        sendMail(mail, { to: s.alertEmail, subject, html, text, kind: "alert" }),
      );
      if (r.ok) sent = true;
      else await deadLetter("email", s.alertEmail, r);
    }
  }

  // Webhook — one generic JSON POST. A non-2xx answer is a failure: the
  // endpoint spoke, but it did not accept the notification.
  if (s.alertWebhookUrl) {
    const body = JSON.stringify(renderWebhookPayload(firing, resolved, brand));
    const r = await withRetries(async () => {
      const res = await fetch(s.alertWebhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    });
    if (r.ok) sent = true;
    else await deadLetter("webhook", s.alertWebhookUrl, r);
  }
  return sent;
}

let started = false;
const FIRST_DELAY_MS = 45_000;

/** Start the in-process alert monitor (single-container deploy). */
export function startAlertMonitor(): void {
  if (started) return;
  started = true;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    let intervalSec = 120;
    try {
      const s = await prisma.systemSettings.findUnique({ where: { id: "config" }, select: { alertPollSec: true, alertsEnabled: true } });
      intervalSec = Math.max(30, s?.alertPollSec || 120);
      if (s?.alertsEnabled) await runAlertCycle();
    } catch (err) {
      console.error("Alert cycle failed:", err);
    } finally {
      // Reschedule with the current interval so config changes take effect live.
      timer = setTimeout(tick, intervalSec * 1000);
      timer.unref?.();
    }
  };

  timer = setTimeout(tick, FIRST_DELAY_MS);
  timer.unref?.();
  console.log("Alert monitor started.");
}
