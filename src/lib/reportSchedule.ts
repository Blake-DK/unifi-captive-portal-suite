/**
 * The pure half of the scheduled summary report: period maths and the email
 * renderer. No local imports, so Node's type-stripping test runner can load
 * it directly; the gatherer/scheduler half lives in summaryReport.ts.
 */

export type ReportFrequency = "daily" | "weekly" | "monthly";

export type ReportPeriod = { start: Date; end: Date; label: string };

const DAY_MS = 86_400_000;
const SEND_HOUR_UTC = 6;

/** The moment the current period's report becomes due, in UTC. */
export function scheduledSendTime(freq: ReportFrequency, now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SEND_HOUR_UTC));
  if (freq === "daily") return d;
  if (freq === "weekly") {
    // Monday of the current week (getUTCDay: Sun=0..Mon=1).
    const back = (now.getUTCDay() + 6) % 7;
    return new Date(d.getTime() - back * DAY_MS);
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, SEND_HOUR_UTC));
}

/** Due when the period's send time has passed and nothing was sent since. */
export function isReportDue(
  freq: ReportFrequency,
  lastSentAt: Date | null,
  now: Date,
): boolean {
  const sendAt = scheduledSendTime(freq, now);
  if (now.getTime() < sendAt.getTime()) return false;
  return lastSentAt === null || lastSentAt.getTime() < sendAt.getTime();
}

/** The period a report sent at `now` covers. */
export function reportPeriod(freq: ReportFrequency, now: Date): ReportPeriod {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (freq === "daily") {
    const start = new Date(todayUtc - DAY_MS);
    return { start, end: new Date(todayUtc), label: start.toISOString().slice(0, 10) };
  }
  if (freq === "weekly") {
    const back = (now.getUTCDay() + 6) % 7;
    const monday = todayUtc - back * DAY_MS;
    const start = new Date(monday - 7 * DAY_MS);
    const end = new Date(monday);
    return {
      start,
      end,
      label: `${start.toISOString().slice(0, 10)} to ${new Date(end.getTime() - DAY_MS).toISOString().slice(0, 10)}`,
    };
  }
  const first = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const prevFirst = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  return {
    start: new Date(prevFirst),
    end: new Date(first),
    label: new Date(prevFirst).toISOString().slice(0, 7),
  };
}

export type SummaryData = {
  period: ReportPeriod;
  usage: { totalGB: number; peakClients: number } | null;
  topClients: { name: string; mac: string; gb: number }[];
  topApps: { app: string; gb: number }[];
  wan: { latencyAvgMs: number | null; samples: number } | null;
  poe: { switches: number; watts: number } | null;
  guests: { registrations: number; vouchersUsed: number; sponsorApproved: number; sponsorDenied: number };
  alerts: { opened: number; resolved: number };
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const round1 = (n: number) => Math.round(n * 10) / 10;

export function renderSummaryEmail(
  d: SummaryData,
  opts: { brand: string; frequency: ReportFrequency },
): { subject: string; html: string; text: string } {
  const subject = `${opts.brand}: ${opts.frequency} network summary — ${d.period.label}`;
  const t: string[] = [`Network summary for ${d.period.label}`, ""];
  const h: string[] = [`<h2>${esc(opts.brand)} — network summary, ${esc(d.period.label)}</h2>`];

  if (d.usage) {
    t.push(`Usage: ${round1(d.usage.totalGB)} GB WiFi traffic, peak ${d.usage.peakClients} wireless clients`);
    h.push(`<p><strong>Usage:</strong> ${round1(d.usage.totalGB)} GB WiFi traffic · peak ${d.usage.peakClients} wireless clients</p>`);
  }
  if (d.wan) {
    t.push(`WAN: average latency ${round1(d.wan.latencyAvgMs ?? 0)} ms over ${d.wan.samples} samples`);
    h.push(`<p><strong>WAN:</strong> average latency ${round1(d.wan.latencyAvgMs ?? 0)} ms (${d.wan.samples} samples)</p>`);
  }
  if (d.poe) {
    t.push(`PoE: ${round1(d.poe.watts)} W currently drawn across ${d.poe.switches} switch(es)`);
    h.push(`<p><strong>PoE:</strong> ${round1(d.poe.watts)} W currently drawn across ${d.poe.switches} switch(es)</p>`);
  }
  t.push(
    `Guests: ${d.guests.registrations} registration(s), ${d.guests.vouchersUsed} via voucher` +
      (d.guests.sponsorApproved + d.guests.sponsorDenied > 0
        ? `, sponsors approved ${d.guests.sponsorApproved} / denied ${d.guests.sponsorDenied}`
        : ""),
  );
  h.push(
    `<p><strong>Guests:</strong> ${d.guests.registrations} registration(s) · ${d.guests.vouchersUsed} via voucher` +
      (d.guests.sponsorApproved + d.guests.sponsorDenied > 0
        ? ` · sponsors approved ${d.guests.sponsorApproved} / denied ${d.guests.sponsorDenied}`
        : "") +
      `</p>`,
  );
  t.push(`Alerts: ${d.alerts.opened} opened, ${d.alerts.resolved} resolved`);
  h.push(`<p><strong>Alerts:</strong> ${d.alerts.opened} opened · ${d.alerts.resolved} resolved</p>`);

  if (d.topClients.length > 0) {
    t.push("", "Top clients:");
    h.push(`<h3>Top clients</h3><table border="0" cellpadding="4">`);
    for (const c of d.topClients) {
      t.push(`  ${round1(c.gb)} GB  ${c.name} (${c.mac})`);
      h.push(`<tr><td>${round1(c.gb)} GB</td><td>${esc(c.name)}</td><td><code>${esc(c.mac)}</code></td></tr>`);
    }
    h.push(`</table>`);
  }
  if (d.topApps.length > 0) {
    t.push("", "Top applications:");
    h.push(`<h3>Top applications</h3><table border="0" cellpadding="4">`);
    for (const a of d.topApps) {
      t.push(`  ${round1(a.gb)} GB  ${a.app}`);
      h.push(`<tr><td>${round1(a.gb)} GB</td><td>${esc(a.app)}</td></tr>`);
    }
    h.push(`</table>`);
  }

  return { subject, html: h.join("\n"), text: t.join("\n") };
}

