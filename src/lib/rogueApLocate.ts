import type { ClassifiedRogue } from "./rogueAps";

/**
 * Locating a rogue/neighbour AP from the controller's scan data. `stat/rogueap`
 * reports one row per (BSSID, detecting AP) with an RSSI, so the same BSSID seen
 * by several of our APs gives a crude fix: the AP hearing it loudest is nearest
 * it. We can't get a true position (no AP coordinates, RSSI isn't a distance),
 * but "which AP is it closest to" is usually enough to walk it down.
 *
 * We also flag on-network devices that might BE the rogue's uplink: a device
 * bridging a second SSID onto our LAN typically broadcasts a BSSID from the same
 * NIC block as its wired MAC (same vendor OUI, numerically adjacent). Those are
 * the boxes to physically check.
 *
 * Pure/testable — no controller calls; the page and any poller share it.
 */

export type Sighting = { apMac: string; rssi: number };

export type GroupedRogue = {
  bssid: string;
  ssid: string;
  security: string;
  channel?: number;
  radio?: string;
  oui?: string;
  spoofing: boolean;
  open: boolean;
  ageMin?: number;
  /** Every AP that heard this BSSID, strongest first (deduped per AP). */
  sightings: Sighting[];
};

export type Proximity = { bucket: "very-close" | "near" | "far" | "distant"; label: string; closeness: number };

export type RogueCandidate = { mac: string; reason: string; confidence: "high" | "low" };

/** 48-bit MAC to an integer, or null if it doesn't parse as 6 hex octets. */
export function macToInt(mac: string): number | null {
  const hex = mac.replace(/[^0-9a-f]/gi, "");
  if (hex.length !== 12) return null;
  const n = Number.parseInt(hex, 16);
  return Number.isFinite(n) ? n : null;
}

/** The vendor OUI (first three octets), lower-cased "aa:bb:cc", or "" if unparseable. */
export function macOui(mac: string): string {
  const hex = mac.replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (hex.length < 6) return "";
  return `${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}`;
}

/**
 * Map an RSSI (dBm, negative) to a proximity band and a 0..1 "closeness" for the
 * radial plot (1 = right on top of the AP, 0 = at the edge of hearing). The
 * -30..-90 dBm span is the usable range; anything stronger pins to 1.
 */
export function proximity(rssi: number): Proximity {
  const closeness = Math.max(0, Math.min(1, (rssi + 90) / 60));
  if (rssi >= -52) return { bucket: "very-close", label: "very close", closeness };
  if (rssi >= -67) return { bucket: "near", label: "near", closeness };
  if (rssi >= -80) return { bucket: "far", label: "far", closeness };
  return { bucket: "distant", label: "distant", closeness };
}

/** Group the flat scan rows by BSSID, collecting every AP that heard each one. */
export function groupRogueSightings(rogues: ClassifiedRogue[]): GroupedRogue[] {
  const byBssid = new Map<string, GroupedRogue>();

  for (const r of rogues) {
    const bssid = r.bssid.toLowerCase();
    const rssi = r.signal ?? r.rssi;
    let g = byBssid.get(bssid);
    if (!g) {
      g = {
        bssid,
        ssid: r.ssid,
        security: r.security ?? "",
        channel: r.channel,
        radio: r.radio,
        oui: r.oui,
        spoofing: r.spoofing,
        open: r.rogueClass === "spoof_open",
        ageMin: r.age != null ? Math.round(r.age / 60) : undefined,
        sightings: [],
      };
      byBssid.set(bssid, g);
    }
    if (r.age != null) {
      const m = Math.round(r.age / 60);
      g.ageMin = g.ageMin == null ? m : Math.min(g.ageMin, m);
    }
    if (r.ap_mac && rssi != null) {
      const apMac = r.ap_mac.toLowerCase();
      const existing = g.sightings.find((s) => s.apMac === apMac);
      if (!existing) g.sightings.push({ apMac, rssi });
      else if (rssi > existing.rssi) existing.rssi = rssi;
    }
  }

  const groups = [...byBssid.values()];
  for (const g of groups) g.sightings.sort((a, b) => b.rssi - a.rssi);
  // Open spoofs first, then spoofs, then loudest, then SSID.
  groups.sort(
    (a, b) =>
      Number(b.open) - Number(a.open) ||
      Number(b.spoofing) - Number(a.spoofing) ||
      (b.sightings[0]?.rssi ?? -999) - (a.sightings[0]?.rssi ?? -999) ||
      a.ssid.localeCompare(b.ssid),
  );
  return groups;
}

/**
 * On-network devices that might be the rogue's uplink. A device bridging a
 * second SSID usually broadcasts from the same NIC block as its wired MAC, so we
 * match candidate MACs that share the BSSID's vendor OUI — flagging the ones
 * numerically adjacent to the BSSID (almost certainly the same hardware) as
 * high confidence. `macs` should already exclude our own adopted gear.
 */
export function rogueCandidates(bssid: string, macs: string[]): RogueCandidate[] {
  const bssidInt = macToInt(bssid);
  const bssidOui = macOui(bssid);
  if (!bssidOui) return [];
  const seen = new Set<string>();
  const out: RogueCandidate[] = [];
  for (const raw of macs) {
    const mac = raw.toLowerCase();
    if (mac === bssid.toLowerCase() || seen.has(mac)) continue;
    if (macOui(mac) !== bssidOui) continue;
    seen.add(mac);
    const mi = macToInt(mac);
    const adjacent = bssidInt != null && mi != null && Math.abs(mi - bssidInt) <= 16;
    out.push({
      mac,
      reason: adjacent ? "MAC adjacent to the BSSID — likely the same hardware" : "same vendor OUI as the BSSID",
      confidence: adjacent ? "high" : "low",
    });
  }
  out.sort((a, b) => Number(b.confidence === "high") - Number(a.confidence === "high") || a.mac.localeCompare(b.mac));
  return out;
}
