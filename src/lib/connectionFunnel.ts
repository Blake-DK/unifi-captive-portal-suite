/**
 * Onboarding connection funnel (Meraki Health "Connection Steps" / Catalyst
 * onboarding phases). The classic controller event log carries per-client
 * association, authentication, DHCP and roam events with pass/fail wording;
 * this reduces a window of them into a funnel with per-stage failure counts
 * and the top failing clients. Pure — no local imports.
 */

export type FunnelEvent = {
  key?: string;
  time?: number;
  msg?: string;
  user?: string;
  guest?: string;
};

export type FunnelStage = "association" | "authentication" | "dhcp" | "roaming";

export type FunnelResult = {
  stages: { stage: FunnelStage; total: number; failed: number }[];
  topFailers: { mac: string; failures: number; lastReason: string }[];
  windowEvents: number;
};

/** Map an event key to (stage, failed?) or null when it isn't an onboarding
 * event. UniFi keys look like EVT_WU_Connected / EVT_WU_Disconnected /
 * EVT_WU_ROAM / EVT_WU_AuthFailure; DHCP shows up in message text. */
function classify(key: string, msg: string): { stage: FunnelStage; failed: boolean } | null {
  const k = key.toLowerCase();
  const m = msg.toLowerCase();
  if (/roam/.test(k)) return { stage: "roaming", failed: /fail/.test(k) };
  if (/auth.*fail|assoc.*reject|badauth/.test(k) || /authentication failed|4-way|psk/.test(m)) {
    return { stage: "authentication", failed: true };
  }
  if (/dhcp|no ip|ip conflict|address/.test(m)) return { stage: "dhcp", failed: /fail|no ip|conflict/.test(m) };
  if (/disconnect/.test(k)) return { stage: "association", failed: false }; // normal leave, not a failure
  if (/connect/.test(k) || /assoc/.test(k)) return { stage: "association", failed: /fail|reject/.test(k) };
  return null;
}

const STAGES: FunnelStage[] = ["association", "authentication", "dhcp", "roaming"];

export function analyzeFunnel(events: FunnelEvent[]): FunnelResult {
  const totals = new Map<FunnelStage, { total: number; failed: number }>(
    STAGES.map((s) => [s, { total: 0, failed: 0 }]),
  );
  const byClient = new Map<string, { failures: number; lastReason: string; lastTime: number }>();
  let considered = 0;

  for (const e of events) {
    const c = classify(e.key ?? "", e.msg ?? "");
    if (!c) continue;
    considered++;
    const t = totals.get(c.stage)!;
    t.total++;
    if (c.failed) {
      t.failed++;
      const who = (e.user ?? e.guest ?? "").toLowerCase();
      if (who) {
        const prev = byClient.get(who) ?? { failures: 0, lastReason: "", lastTime: 0 };
        prev.failures++;
        if ((e.time ?? 0) >= prev.lastTime) {
          prev.lastTime = e.time ?? 0;
          prev.lastReason = e.msg || e.key || c.stage;
        }
        byClient.set(who, prev);
      }
    }
  }

  return {
    stages: STAGES.map((stage) => ({ stage, ...totals.get(stage)! })),
    topFailers: [...byClient.entries()]
      .map(([mac, v]) => ({ mac, failures: v.failures, lastReason: v.lastReason }))
      .sort((a, b) => b.failures - a.failures)
      .slice(0, 10),
    windowEvents: considered,
  };
}
