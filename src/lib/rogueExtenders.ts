import { canonicalizeMac } from "./mac.ts"; // explicit extension so alerts.test.ts runs under Node's type-stripping runner

/**
 * Heuristic detection of consumer WiFi range extenders / mesh nodes among
 * connected clients. Two independent signals, combined into a confidence
 * tier rather than a single yes/no:
 *
 *  - hostname/alias matches a known extender/mesh naming pattern -> "high"
 *    confidence, regardless of OUI (a device named "orbi" or "RE450" is
 *    essentially never anything else).
 *  - MAC OUI matches a vendor known for extender/mesh hardware, but no
 *    hostname signal -> "low" confidence (several of these vendors also sell
 *    plain routers/other gear under the same OUI blocks, so this is a hint,
 *    not a verdict).
 *
 * Pure and dependency-free (besides MAC canonicalization) so it's usable
 * from both a page render and the alert engine.
 */

export type MatchConfidence = "high" | "low";

export type ExtenderMatch = {
  confidence: MatchConfidence;
  vendor: string | null;
  matchedBy: ("hostname" | "oui")[];
  reason: string;
};

export const EXTENDER_HOSTNAME_PATTERNS: RegExp[] = [
  /extender/i,
  /repeater/i,
  /\brange[- ]?ext/i,
  /\bmesh\b/i,
  /orbi/i,
  /deco/i,
  /velop/i,
  /eero/i,
  /amplifi/i,
  /\bnova\b/i,
  /\bhalo\b/i,
  /\bRE\d{3,4}\b/i, // TP-Link RE-series, e.g. RE450, RE650
  /\bEX\d{4}\b/i, // Netgear EX-series, e.g. EX3700, EX6120
  /\bWAP\d{3}\b/i, // various vendor wireless AP/extender model numbers
];

// Seed table only — every entry needs re-verification against the IEEE OUI
// registry (https://standards-oui.ieee.org/oui/oui.txt) before being trusted
// as exhaustive. Vendors like TP-Link/Netgear/D-Link hold dozens of OUI
// blocks each; this lists a starter handful, not a complete set. Treat as
// living data, not a one-time-correct table.
export const EXTENDER_OUI_VENDORS: Record<string, string> = {
  "18:b4:30": "Nest Labs (Nest Wifi / Google Wifi point)",
  "b0:b9:8a": "eero",
  "9c:53:22": "Netgear (EX/Orbi)",
  "a0:40:a0": "Netgear",
  "c8:d3:a3": "D-Link (DAP-series)",
  "1c:7e:e5": "D-Link",
  "f4:f2:6d": "TP-Link (RE-series shares this block with routers)",
  "50:c7:bf": "TP-Link",
  "48:f8:b3": "Linksys/Belkin (RE-series)",
  "5c:3c:27": "Devolo",
};

function matchHostname(hostname?: string | null, name?: string | null): RegExp | null {
  for (const candidate of [name, hostname]) {
    if (!candidate) continue;
    for (const re of EXTENDER_HOSTNAME_PATTERNS) {
      if (re.test(candidate)) return re;
    }
  }
  return null;
}

export function detectExtender(input: {
  mac: string;
  hostname?: string | null;
  name?: string | null;
}): ExtenderMatch | null {
  const hostnameHit = matchHostname(input.hostname, input.name);

  const canonical = canonicalizeMac(input.mac);
  const oui = canonical ? canonical.slice(0, 8) : null;
  const vendor = oui ? EXTENDER_OUI_VENDORS[oui] ?? null : null;

  if (hostnameHit) {
    return {
      confidence: "high",
      vendor,
      matchedBy: vendor ? ["hostname", "oui"] : ["hostname"],
      reason: `hostname/name matches ${hostnameHit}`,
    };
  }

  if (vendor) {
    return {
      confidence: "low",
      vendor,
      matchedBy: ["oui"],
      reason: `OUI ${oui} → ${vendor}`,
    };
  }

  return null;
}

export function detectExtenders(
  stations: { mac: string; hostname?: string | null; name?: string | null }[],
): Map<string, ExtenderMatch> {
  const out = new Map<string, ExtenderMatch>();
  for (const sta of stations) {
    const match = detectExtender(sta);
    if (match) out.set(sta.mac.toLowerCase(), match);
  }
  return out;
}
