/**
 * Per-client health + journey (Catalyst Client 360's model, adapted and
 * stated plainly). No local imports — Node's type-stripping test runner
 * loads this directly.
 *
 * Score, 0-10, deterministic:
 *   wired + connected                          → 10
 *   wireless: signal > -72 dBm AND SNR > 9 dB  → 10
 *             one of the two                   → 7
 *             neither                          → 4
 *   not connected                              → 0 ("offline")
 * The thresholds are Cisco's published ones; the classic API's `rssi` field
 * is already signal-above-noise, so it stands in for SNR when the dBm pair
 * is present or absent.
 */

export type ClientHealthInput = {
  connected: boolean;
  wired: boolean;
  signalDbm?: number | null;
  snrDb?: number | null;
};

export type ClientHealth = {
  score: number;
  label: "good" | "fair" | "poor" | "offline";
  reasons: string[];
};

const SIGNAL_GOOD_DBM = -72;
const SNR_GOOD_DB = 9;

export function scoreClient(i: ClientHealthInput): ClientHealth {
  if (!i.connected) return { score: 0, label: "offline", reasons: ["Not connected right now"] };
  if (i.wired) return { score: 10, label: "good", reasons: ["Wired connection"] };

  const reasons: string[] = [];
  let signalGood: boolean | null = null;
  let snrGood: boolean | null = null;
  if (typeof i.signalDbm === "number") {
    signalGood = i.signalDbm > SIGNAL_GOOD_DBM;
    reasons.push(`Signal ${i.signalDbm} dBm (${signalGood ? "above" : "below"} ${SIGNAL_GOOD_DBM})`);
  }
  if (typeof i.snrDb === "number") {
    snrGood = i.snrDb > SNR_GOOD_DB;
    reasons.push(`SNR ${i.snrDb} dB (${snrGood ? "above" : "below"} ${SNR_GOOD_DB})`);
  }
  const known = [signalGood, snrGood].filter((x): x is boolean => x !== null);
  if (known.length === 0) {
    return { score: 7, label: "fair", reasons: ["Connected; no RF readings reported"] };
  }
  const good = known.filter(Boolean).length;
  const score = good === known.length ? 10 : good > 0 ? 7 : 4;
  return { score, label: score === 10 ? "good" : score === 7 ? "fair" : "poor", reasons };
}

export type JourneyEntry = {
  time: number; // epoch ms
  kind: "connect" | "disconnect" | "roam" | "other";
  text: string;
  ap?: string;
};

type JourneyEvent = {
  key?: string;
  time?: number;
  msg?: string;
  user?: string;
  guest?: string;
  ap?: string;
  ap_name?: string;
  ssid?: string;
};

/** The client's slice of the controller event log, newest first. Client MACs
 * ride in `user` (LAN/WLAN users) or `guest` (guest-authorized clients). */
export function journeyFromEvents(events: JourneyEvent[], mac: string): JourneyEntry[] {
  const target = mac.toLowerCase();
  const out: JourneyEntry[] = [];
  for (const e of events) {
    const who = (e.user ?? e.guest ?? "").toLowerCase();
    if (who !== target || !e.time) continue;
    const key = e.key ?? "";
    // Test disconnect BEFORE connect: "Disconnected" ends in "connected",
    // so /connected$/ would otherwise claim it.
    const kind: JourneyEntry["kind"] = /roam/i.test(key)
      ? "roam"
      : /disconnected$/i.test(key)
        ? "disconnect"
        : /connected$/i.test(key)
          ? "connect"
          : "other";
    out.push({
      time: e.time,
      kind,
      text: e.msg ?? key,
      ap: e.ap_name ?? e.ap,
    });
  }
  return out.sort((a, b) => b.time - a.time);
}
