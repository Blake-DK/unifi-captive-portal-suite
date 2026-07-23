import { prisma } from "./prisma";
import { invalidateSettingsRow } from "./settingsRow";
import { getDailySiteStats, getDpiTraffic, listDevices } from "./unifi";
import { dpiAppName } from "./dpiCatalog";
import { getMailSettings, isMailConfigured, sendMail } from "./mailer";
import { auditSystem } from "./audit";
import { withRetries } from "./notifyRetry";
import {
  isReportDue,
  renderSummaryEmail,
  reportPeriod,
  type ReportFrequency,
  type ReportPeriod,
  type SummaryData,
} from "./reportSchedule";

export {
  isReportDue,
  renderSummaryEmail,
  reportPeriod,
  scheduledSendTime,
  type ReportFrequency,
  type ReportPeriod,
  type SummaryData,
} from "./reportSchedule";

/**
 * Scheduled summary report (Meraki's model): one email per period with
 * usage, top talkers, WAN health, PoE consumption, guest activity and alert
 * counts. Daily reports cover yesterday, weekly reports go out Mondays for
 * the previous Mon-Sun, monthly on the 1st for the previous month; all send
 * on the first scheduler tick after 06:00 UTC. The period maths and the
 * renderer are pure and unit-tested; the gatherer degrades per section (a
 * missing data source drops its section, never the report).
 */

const gb = (bytes: number) => bytes / 1024 ** 3;

export async function buildSummaryData(period: ReportPeriod): Promise<SummaryData> {
  const startMs = period.start.getTime();
  const endMs = period.end.getTime();

  // Site usage from the controller's daily report store.
  const usage = await getDailySiteStats(startMs, endMs)
    .then((rows) =>
      rows.length
        ? {
            totalGB: gb(rows.reduce((n, r) => n + r.wlanBytes, 0)),
            peakClients: Math.max(...rows.map((r) => r.wlanClients)),
          }
        : null,
    )
    .catch(() => null);

  // Top talkers by client and by app, from per-client DPI.
  let topClients: SummaryData["topClients"] = [];
  let topApps: SummaryData["topApps"] = [];
  try {
    const dpi = await getDpiTraffic(startMs, endMs);
    const appTotals = new Map<string, number>();
    topClients = dpi
      .map((c) => {
        const bytes = c.usage_by_app.reduce((n, u) => {
          const b = u.total_bytes ?? (u.bytes_received ?? 0) + (u.bytes_transmitted ?? 0);
          const label = dpiAppName(u.category, u.application);
          appTotals.set(label, (appTotals.get(label) ?? 0) + b);
          return n + b;
        }, 0);
        return {
          name: c.client.name || c.client.hostname || c.client.mac,
          mac: c.client.mac,
          gb: gb(bytes),
        };
      })
      .sort((a, b) => b.gb - a.gb)
      .slice(0, 10);
    topApps = [...appTotals.entries()]
      .map(([app, bytes]) => ({ app, gb: gb(bytes) }))
      .sort((a, b) => b.gb - a.gb)
      .slice(0, 10);
  } catch {
    /* DPI off or unreachable — drop the section */
  }

  // WAN latency over the period, from the metric history.
  const wan = await prisma.metricSample
    .aggregate({
      where: { scope: "site", at: { gte: period.start, lt: period.end }, wanLatency: { not: null } },
      _avg: { wanLatency: true },
      _count: { _all: true },
    })
    .then((a) => ({ latencyAvgMs: a._avg.wanLatency, samples: a._count._all }))
    .catch(() => null);

  // PoE consumption: a point-in-time snapshot (draw isn't sampled over time).
  const poe = await listDevices()
    .then((devices) => {
      let watts = 0;
      let switches = 0;
      for (const d of devices) {
        const ports = d.port_table ?? [];
        const w = ports.reduce((n, p) => n + (Number(p.poe_power) || 0), 0);
        if (w > 0) {
          switches++;
          watts += w;
        }
      }
      return { switches, watts };
    })
    .catch(() => null);

  const [registrations, vouchersUsed, sponsorApproved, sponsorDenied, opened, resolved] =
    await Promise.all([
      prisma.guestRegistration.count({ where: { authorizedAt: { gte: period.start, lt: period.end } } }),
      prisma.guestRegistration.count({
        where: { authorizedAt: { gte: period.start, lt: period.end }, voucherId: { not: null } },
      }),
      prisma.sponsorRequest.count({
        where: { decidedAt: { gte: period.start, lt: period.end }, status: "approved" },
      }),
      prisma.sponsorRequest.count({
        where: { decidedAt: { gte: period.start, lt: period.end }, status: "denied" },
      }),
      prisma.alert.count({ where: { firstSeenAt: { gte: period.start, lt: period.end } } }),
      prisma.alert.count({ where: { resolvedAt: { gte: period.start, lt: period.end } } }),
    ]).catch(() => [0, 0, 0, 0, 0, 0]);

  return {
    period,
    usage,
    topClients,
    topApps,
    wan: wan && wan.samples > 0 ? wan : null,
    poe,
    guests: { registrations, vouchersUsed, sponsorApproved, sponsorDenied },
    alerts: { opened, resolved },
  };
}

export type ReportRunStats = { sent: boolean; skipped?: string };

export async function runReportCycle(now = new Date()): Promise<ReportRunStats> {
  const s = await prisma.systemSettings.findUnique({ where: { id: "config" } });
  if (!s?.reportEnabled) return { sent: false, skipped: "disabled" };
  const freq = (["daily", "weekly", "monthly"] as const).includes(s.reportFrequency as ReportFrequency)
    ? (s.reportFrequency as ReportFrequency)
    : "weekly";
  if (!isReportDue(freq, s.reportLastSentAt, now)) return { sent: false, skipped: "not due" };

  const mail = await getMailSettings();
  const to = s.reportEmail.trim() || s.alertEmail.trim();
  if (!to || !isMailConfigured(mail)) return { sent: false, skipped: "no recipient or mail unconfigured" };

  const data = await buildSummaryData(reportPeriod(freq, now));
  const rendered = renderSummaryEmail(data, { brand: mail.brandName || "Network", frequency: freq });
  const r = await withRetries(() => sendMail(mail, { to, ...rendered, kind: "report" }));
  if (!r.ok) {
    await auditSystem({
      actorType: "system",
      actor: "report-scheduler",
      action: "report.send",
      target: to,
      detail: { frequency: freq, period: data.period.label, attempts: r.attempts, error: r.lastError ?? "" },
      outcome: "failure",
    });
    return { sent: false, skipped: `send failed: ${r.lastError}` };
  }

  await prisma.systemSettings.update({
    where: { id: "config" },
    data: { reportLastSentAt: now },
  });
  invalidateSettingsRow();
  await auditSystem({
    actorType: "system",
    actor: "report-scheduler",
    action: "report.send",
    target: to,
    detail: { frequency: freq, period: data.period.label },
  });
  return { sent: true };
}

let started = false;

/** Hourly tick; runReportCycle decides whether anything is due. */
export function startReportScheduler(): void {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      await runReportCycle();
    } catch (err) {
      console.error("Report cycle failed:", err);
    }
  };
  const timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref?.();
  setTimeout(tick, 90_000).unref?.();
  console.log("Report scheduler started (hourly).");
}
