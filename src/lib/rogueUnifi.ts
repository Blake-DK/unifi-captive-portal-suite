/**
 * Un-onboarded UniFi hardware — APs, switches, gateways that show up as
 * CLIENTS because they were never adopted onto this site (a factory-reset
 * device awaiting onboarding, gear someone plugged into the wire, or a
 * neighbouring network's router).
 *
 * Detection has one authoritative signal and one heuristic:
 *  - the controller's own vendor resolution (`oui`) says Ubiquiti; this is
 *    the same knowledge that makes it refuse `Block` with
 *    api.err.BlockUnifiDeviceForbidden — the refusal is what surfaced these
 *    devices in the first place;
 *  - the MAC's OUI prefix matches a known Ubiquiti allocation, for
 *    controllers that don't populate `oui`.
 *
 * Adopted devices never reach here: loadClients()/this module both filter
 * against the adopted-device MAC set (base + interface + BSSID + the
 * locally-administered variant, via physicalMacForm).
 *
 * Pure/testable; the operator-decision rows (mark/ignore) live in the
 * RogueUnifiDevice table and are applied by the caller.
 */

export type RogueStatus = "detected" | "marked" | "ignored" | "ignored-until-reconnect";

export type RogueCandidate = {
  mac: string;
  hostname: string | null;
  ip: string | null;
  vendor: string | null;
  wired: boolean;
  /** Uplink device + port, when the controller knows it. */
  uplink: string | null;
  online: boolean;
  status: RogueStatus;
  note: string;
  /** Why this row is here, for the table's "reason" column. */
  reason: string;
};

/** Ubiquiti OUI prefixes (base MAC, lowercase, colon-separated first three
 * octets). Not exhaustive — the controller's `oui` field is the primary
 * signal; this list catches controllers that leave it blank. */
const UBIQUITI_OUIS = new Set([
  "00:15:6d",
  "00:27:22",
  "04:18:d6",
  "18:e8:29",
  "24:5a:4c",
  "24:a4:3c",
  "44:d9:e7",
  "68:72:51",
  "68:d7:9a",
  "70:a7:41",
  "74:83:c2",
  "78:45:58",
  "78:8a:20",
  "80:2a:a8",
  "9c:05:d6",
  "b4:fb:e4",
  "d0:21:f9",
  "dc:9f:db",
  "e0:63:da",
  "f0:9f:c2",
  "f4:e2:c6", // EdgeMAX / EdgeSwitch — Ubiquiti gear a UniFi controller never adopts
  "fc:ec:da",
]);

/** Locally-administered bit set = randomised (private) client MAC. Mirrors
 * isLocallyAdministered in src/lib/dupIp.ts; duplicated so this module stays
 * import-free for the type-stripping test runner. */
function isLocallyAdministered(mac: string): boolean {
  const first = parseInt(mac.trim().slice(0, 2), 16);
  return Number.isFinite(first) && (first & 0x02) !== 0;
}

export function isUbiquitiVendor(oui: string | null | undefined): boolean {
  const v = (oui ?? "").toLowerCase();
  return v.includes("ubiquiti") || v.includes("unifi");
}

/**
 * OUI match — GLOBALLY-ADMINISTERED MACs only.
 *
 * A randomised (locally-administered) client MAC carries a fabricated OUI:
 * clearing the LA bit to "recover" a vendor prefix is meaningless and
 * collides with real allocations (e2:63:da → e0:63:da). On a site with ~835
 * randomised MACs that is a live false-positive source — and it is exactly
 * how the controller itself misfires, refusing `block-sta` on a randomised
 * TP-Link extender MAC as if it were UniFi hardware. Genuine un-onboarded
 * UniFi gear always advertises its real, registered OUI.
 */
export function isUbiquitiMac(mac: string): boolean {
  if (isLocallyAdministered(mac)) return false;
  return UBIQUITI_OUIS.has(mac.toLowerCase().split(":").slice(0, 3).join(":"));
}

export type RogueStation = {
  mac: string;
  hostname?: string | null;
  name?: string | null;
  ip?: string | null;
  oui?: string | null;
  is_wired?: boolean;
  uplink?: string | null;
};

export type RogueDecision = { mac: string; status: string; note: string };

/**
 * Build the tab's rows from the CURRENT station list plus the operator's
 * stored decisions. Stations that are neither detected nor marked are not
 * rogue candidates and produce no row. Decisions for MACs that are NOT in the
 * current station list still appear (as offline) so an ignore can be reviewed
 * or lifted when the device is unplugged.
 */
export function buildRogueRows(
  stations: RogueStation[],
  decisions: RogueDecision[],
): RogueCandidate[] {
  const byMac = new Map(decisions.map((d) => [d.mac.toLowerCase(), d]));
  const seen = new Set<string>();
  const rows: RogueCandidate[] = [];

  for (const s of stations) {
    const mac = s.mac.toLowerCase();
    const decision = byMac.get(mac);
    const vendorHit = isUbiquitiVendor(s.oui);
    const macHit = isUbiquitiMac(mac);
    const marked = decision?.status === "marked";
    if (!vendorHit && !macHit && !marked) continue;

    seen.add(mac);
    // An ignore-until-reconnect clears the moment the device is seen online.
    const status: RogueStatus =
      decision?.status === "ignored"
        ? "ignored"
        : marked
          ? "marked"
          : "detected";
    rows.push({
      mac: s.mac,
      hostname: s.name ?? s.hostname ?? null,
      ip: s.ip ?? null,
      vendor: s.oui ?? null,
      wired: Boolean(s.is_wired),
      uplink: s.uplink ?? null,
      online: true,
      status,
      note: decision?.note ?? "",
      reason: marked
        ? "Marked by an operator as un-onboarded UniFi hardware"
        : vendorHit
          ? `Controller resolves the vendor as “${s.oui}” but the device is not adopted on this site`
          : "MAC belongs to a Ubiquiti OUI but the device is not adopted on this site",
    });
  }

  // Offline decisions: rows the operator acted on that aren't currently
  // associated. ignored-until-reconnect stays hidden here (it is "hide while
  // offline"); the caller filters it out of the default view but can show it.
  for (const d of decisions) {
    const mac = d.mac.toLowerCase();
    if (seen.has(mac)) continue;
    rows.push({
      mac,
      hostname: null,
      ip: null,
      vendor: null,
      wired: false,
      uplink: null,
      online: false,
      status: (d.status as RogueStatus) ?? "marked",
      note: d.note,
      reason: "Not currently connected",
    });
  }

  return rows.sort((a, b) => Number(b.online) - Number(a.online) || a.mac.localeCompare(b.mac));
}

/** MACs whose stored decision must be dropped because the device is back
 * online (ignore-until-reconnect is a one-shot hide). */
export function reconnectedIgnores(stations: RogueStation[], decisions: RogueDecision[]): string[] {
  const online = new Set(stations.map((s) => s.mac.toLowerCase()));
  return decisions
    .filter((d) => d.status === "ignored-until-reconnect" && online.has(d.mac.toLowerCase()))
    .map((d) => d.mac.toLowerCase());
}

/** MACs to hide from the clients/extenders tables and the rogue default view. */
export function hiddenMacs(decisions: RogueDecision[]): Set<string> {
  return new Set(
    decisions
      .filter((d) => d.status === "ignored" || d.status === "ignored-until-reconnect")
      .map((d) => d.mac.toLowerCase()),
  );
}
