/**
 * Duplicate-IP false-positive classification. On networks with MAC
 * randomisation, UniFi fires duplicate-IP alarms for two randomised MACs that
 * merely held the same IP at different times — hundreds of them, all noise.
 * This module gates those alarms with confidence checks ordered cheap →
 * expensive, short-circuiting at the first decisive one:
 *
 *   (a) MAC randomisation — both MACs locally administered
 *   (b) session overlap  — the two clients were never online at the same time
 *   (c) DHCP cross-ref   — at most one currently-connected holder of the IP
 *   (d) arping           — authoritative on-wire probe (impure, lives in
 *                          dupIpArping.ts; this module only parses its output)
 *
 * Everything here is pure and dependency-free so it unit-tests without a
 * controller (run with `npm test`). The poller (dupIpMonitor.ts) supplies the
 * data and applies the verdicts. The controller's exact alarm payload varies
 * by firmware, so parsing is defensive: structured fields first, message-text
 * regex as fallback — and the dry-run mode exists precisely to verify this
 * parser against live alarms before any alert fires.
 */

export type DupIpAlarm = {
  ip: string;
  macs: string[]; // 0–2 parsed MACs, lowercase, deduped
  vlan?: number;
  timeMs?: number; // controller alarm timestamp (epoch ms)
  key?: string;
  msg?: string;
};

const MAC_RE = /\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b/gi;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/** Locally-administered bit set = randomised (private) MAC. */
export function isLocallyAdministered(mac: string): boolean {
  const first = parseInt(mac.trim().slice(0, 2), 16);
  return Number.isFinite(first) && (first & 0x02) !== 0;
}

/** Does this controller alarm look like a duplicate-IP warning? */
export function isDuplicateIpAlarm(alarm: { key?: unknown; msg?: unknown }): boolean {
  const key = String(alarm.key ?? "").toLowerCase();
  const msg = String(alarm.msg ?? "").toLowerCase();
  return (
    (key.includes("ip") && (key.includes("dup") || key.includes("conflict"))) ||
    msg.includes("duplicate ip") ||
    msg.includes("ip conflict") ||
    msg.includes("ip address conflict")
  );
}

/**
 * Extract IP, MAC pair and VLAN from a duplicate-IP alarm. Structured fields
 * win; the human message text is the fallback. Returns null for alarms that
 * aren't duplicate-IP or where no IP can be found at all.
 */
export function parseDuplicateIpAlarm(raw: Record<string, unknown>): DupIpAlarm | null {
  if (!isDuplicateIpAlarm(raw)) return null;
  const msg = String(raw.msg ?? "");

  const fieldStr = (k: string): string | undefined =>
    typeof raw[k] === "string" && (raw[k] as string).trim() ? (raw[k] as string).trim() : undefined;

  const ip = fieldStr("ip") ?? fieldStr("dst_ip") ?? fieldStr("duplicate_ip") ?? (msg.match(IP_RE) ?? [])[0];
  if (!ip) return null;

  const macs = new Set<string>();
  for (const k of ["mac", "sta_mac", "client_mac", "mac1", "mac2"]) {
    const v = fieldStr(k);
    if (v && MAC_RE.test(v)) macs.add(v.toLowerCase().replace(/-/g, ":"));
    MAC_RE.lastIndex = 0;
  }
  for (const m of msg.match(MAC_RE) ?? []) macs.add(m.toLowerCase().replace(/-/g, ":"));

  let vlan: number | undefined;
  if (raw.vlan != null && Number.isFinite(Number(raw.vlan))) vlan = Number(raw.vlan);
  else {
    const m = msg.match(/vlan\s*[:#"]?\s*(\d{1,4})/i);
    if (m) vlan = Number(m[1]);
  }

  let timeMs: number | undefined;
  if (typeof raw.time === "number") timeMs = raw.time;
  else if (typeof raw.datetime === "string") {
    const t = Date.parse(raw.datetime);
    if (Number.isFinite(t)) timeMs = t;
  }

  return {
    ip,
    macs: [...macs].sort().slice(0, 2),
    vlan,
    timeMs,
    key: typeof raw.key === "string" ? raw.key : undefined,
    msg: msg || undefined,
  };
}

/** A client's presence window (epoch seconds); open ends = unknown. */
export type SessionWindow = { startSec?: number; endSec?: number };

/** Do two presence windows overlap? Unknown bounds are treated as open (overlap-leaning). */
export function windowsOverlap(a: SessionWindow, b: SessionWindow): boolean {
  const aStart = a.startSec ?? -Infinity;
  const aEnd = a.endSec ?? Infinity;
  const bStart = b.startSec ?? -Infinity;
  const bEnd = b.endSec ?? Infinity;
  return aStart <= bEnd && bStart <= aEnd;
}

export type DupIpChecks = {
  macRandom: boolean;
  sessions: boolean;
  dhcp: boolean;
};

export type DupIpData = {
  /** Presence window per MAC (lowercase) — absent = not currently known to the controller. */
  windows: Map<string, SessionWindow>;
  /** Currently-connected clients, for counting live holders of the alarm IP. */
  stations: { mac: string; ip?: string }[];
};

export type DupIpVerdict = {
  verdict: "suppress" | "genuine" | "inconclusive";
  reasons: string[];
};

/**
 * Run checks (a)–(c) against one parsed alarm. Short-circuits at the first
 * decisive check; "inconclusive" means the caller should escalate to the
 * arping probe (d) — or, if that's unavailable, open the alert unverified,
 * because this gate must never hide a genuine conflict.
 */
export function classifyDuplicateIp(alarm: DupIpAlarm, checks: DupIpChecks, data: DupIpData): DupIpVerdict {
  // (a) Both MACs randomised — the classic MAC-randomisation false positive.
  if (checks.macRandom && alarm.macs.length === 2 && alarm.macs.every(isLocallyAdministered)) {
    return { verdict: "suppress", reasons: ["both MACs are randomised (locally administered)"] };
  }

  // (b) Sessions never overlapped — two devices can't conflict if they were
  // never online together. A MAC with no window isn't online now: no overlap.
  if (checks.sessions && alarm.macs.length === 2) {
    const [wa, wb] = alarm.macs.map((m) => data.windows.get(m));
    if (!wa || !wb) {
      return { verdict: "suppress", reasons: ["at most one of the two clients is currently online"] };
    }
    if (!windowsOverlap(wa, wb)) {
      return { verdict: "suppress", reasons: ["the two clients' sessions do not overlap"] };
    }
  }

  // (c) Live holders of the IP among connected clients (same connected-client
  // proxy the DHCP-pool feature uses). Two+ live holders is a real conflict;
  // one or zero means nothing is fighting for the address right now.
  if (checks.dhcp && data.stations.length > 0) {
    const holders = new Set(
      data.stations.filter((s) => s.ip === alarm.ip).map((s) => s.mac.toLowerCase()),
    );
    if (holders.size >= 2) {
      return { verdict: "genuine", reasons: [`${holders.size} connected clients hold ${alarm.ip} right now`] };
    }
    return { verdict: "suppress", reasons: [`${holders.size === 1 ? "only one connected client holds" : "no connected client holds"} ${alarm.ip}`] };
  }

  return { verdict: "inconclusive", reasons: ["checks disabled or no client data"] };
}

/**
 * Parse the arping device map setting: one `<vlan>=<device MAC>` per line,
 * `*` as VLAN = any (usually the gateway). Returns lowercase MACs keyed by
 * VLAN number, with the wildcard under "*".
 */
export function parseArpingMap(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of (text ?? "").split(/\r?\n/)) {
    const m = line.trim().match(/^(\*|\d{1,4})\s*[=:]\s*([0-9a-f]{2}(?:[:-][0-9a-f]{2}){5})$/i);
    if (m) out.set(m[1], m[2].toLowerCase().replace(/-/g, ":"));
  }
  return out;
}

/**
 * Distinct responder MACs in `arping` / `ip neigh` output, minus the probing
 * device's own MAC. More than one distinct responder = genuine conflict.
 */
export function parseArpingResponders(output: string, excludeMac?: string): string[] {
  const macs = new Set<string>();
  for (const m of output.match(MAC_RE) ?? []) {
    const mac = m.toLowerCase().replace(/-/g, ":");
    if (mac !== "00:00:00:00:00:00" && mac !== excludeMac?.toLowerCase()) macs.add(mac);
  }
  return [...macs].sort();
}
