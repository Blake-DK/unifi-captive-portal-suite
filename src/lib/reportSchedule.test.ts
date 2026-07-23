import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isReportDue,
  reportPeriod,
  renderSummaryEmail,
  scheduledSendTime,
  type SummaryData,
} from "./reportSchedule.ts"; // explicit extension for Node's type-stripping runner

const at = (iso: string) => new Date(iso);

describe("scheduledSendTime / isReportDue", () => {
  it("daily: due after 06:00 UTC, once", () => {
    assert.equal(isReportDue("daily", null, at("2026-07-08T05:59:00Z")), false);
    assert.equal(isReportDue("daily", null, at("2026-07-08T06:01:00Z")), true);
    const sent = at("2026-07-08T06:05:00Z");
    assert.equal(isReportDue("daily", sent, at("2026-07-08T18:00:00Z")), false);
    assert.equal(isReportDue("daily", sent, at("2026-07-09T06:05:00Z")), true);
  });

  it("weekly: due Mondays, and late starts still send mid-week once", () => {
    // 2026-07-06 is a Monday.
    assert.equal(isReportDue("weekly", null, at("2026-07-06T06:30:00Z")), true);
    const sent = at("2026-07-06T06:30:00Z");
    assert.equal(isReportDue("weekly", sent, at("2026-07-09T12:00:00Z")), false);
    assert.equal(isReportDue("weekly", sent, at("2026-07-13T06:30:00Z")), true);
    // Enabled on a Thursday with nothing ever sent: this week's Monday send
    // time has passed → send now rather than waiting almost a week.
    assert.equal(isReportDue("weekly", null, at("2026-07-09T12:00:00Z")), true);
  });

  it("monthly: the 1st at 06:00", () => {
    assert.equal(scheduledSendTime("monthly", at("2026-07-15T00:00:00Z")).toISOString(), "2026-07-01T06:00:00.000Z");
    const sent = at("2026-07-01T06:30:00Z");
    assert.equal(isReportDue("monthly", sent, at("2026-07-20T00:00:00Z")), false);
    assert.equal(isReportDue("monthly", sent, at("2026-08-01T06:30:00Z")), true);
  });
});

describe("reportPeriod", () => {
  it("daily covers yesterday", () => {
    const p = reportPeriod("daily", at("2026-07-08T06:30:00Z"));
    assert.equal(p.start.toISOString(), "2026-07-07T00:00:00.000Z");
    assert.equal(p.end.toISOString(), "2026-07-08T00:00:00.000Z");
    assert.equal(p.label, "2026-07-07");
  });

  it("weekly covers the previous Mon-Sun", () => {
    const p = reportPeriod("weekly", at("2026-07-06T06:30:00Z")); // a Monday
    assert.equal(p.start.toISOString(), "2026-06-29T00:00:00.000Z");
    assert.equal(p.end.toISOString(), "2026-07-06T00:00:00.000Z");
    assert.equal(p.label, "2026-06-29 to 2026-07-05");
  });

  it("monthly covers the previous month, across year ends too", () => {
    const p = reportPeriod("monthly", at("2026-01-01T06:30:00Z"));
    assert.equal(p.start.toISOString(), "2025-12-01T00:00:00.000Z");
    assert.equal(p.end.toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(p.label, "2025-12");
  });
});

describe("renderSummaryEmail", () => {
  const data: SummaryData = {
    period: { start: at("2026-07-01T00:00:00Z"), end: at("2026-07-08T00:00:00Z"), label: "2026-07-01 to 2026-07-07" },
    usage: { totalGB: 123.456, peakClients: 987 },
    topClients: [{ name: "<Laptop>", mac: "aa:bb:cc:11:22:33", gb: 42.15 }],
    topApps: [{ app: "5", gb: 9.99 }],
    wan: { latencyAvgMs: 8.4, samples: 2016 },
    poe: { switches: 12, watts: 345.6 },
    guests: { registrations: 51, vouchersUsed: 3, sponsorApproved: 2, sponsorDenied: 1 },
    alerts: { opened: 4, resolved: 5 },
  };

  it("renders every section and escapes names", () => {
    const m = renderSummaryEmail(data, { brand: "Base WiFi", frequency: "weekly" });
    assert.match(m.subject, /weekly network summary/);
    assert.match(m.text, /123\.5 GB/);
    assert.match(m.text, /peak 987/);
    assert.match(m.text, /42\.2 GB/);
    assert.match(m.text, /sponsors approved 2 \/ denied 1/);
    assert.ok(m.html.includes("&lt;Laptop&gt;"));
  });

  it("drops sections whose data is missing", () => {
    const m = renderSummaryEmail(
      { ...data, usage: null, wan: null, poe: null, topClients: [], topApps: [] },
      { brand: "B", frequency: "daily" },
    );
    assert.doesNotMatch(m.text, /GB WiFi traffic|latency|PoE|Top clients/);
    assert.match(m.text, /Alerts: 4 opened/);
  });
});
