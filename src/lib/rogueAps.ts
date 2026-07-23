import type { UniFiRogueAp } from "./unifi";
import type { DesiredAlert } from "./alerts";

/**
 * Neighbouring-AP ("rogue AP") analysis over the controller's own scan data.
 *
 * The dangerous case for a captive-portal network is an **evil twin**: a
 * neighbouring AP broadcasting one of *our* SSIDs (a client that associates to
 * it is handing credentials/traffic to an attacker). Neighbours broadcasting
 * their own SSIDs are just noise. An open (unencrypted) copy of our SSID is the
 * worst — no key needed to impersonate us — so it rates higher.
 *
 * Pure/testable: takes the scan rows + our SSID set, returns classified rows
 * and the desired alerts, so the poller and the page share one definition.
 */

export type RogueClass = "spoof_open" | "spoof" | "neighbour";

export type ClassifiedRogue = UniFiRogueAp & {
  ssid: string; // essid, normalised ("" = hidden)
  spoofing: boolean; // broadcasting one of our SSIDs
  rogueClass: RogueClass;
};

const OPEN_SECURITY = new Set(["", "open", "none"]);

function normSsid(s?: string): string {
  return (s ?? "").trim();
}

/** Lower-cased set of our SSIDs for case-insensitive comparison. */
export function ourSsidSet(names: string[]): Set<string> {
  return new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
}

export function classifyRogues(rogues: UniFiRogueAp[], ourSsids: Set<string>): ClassifiedRogue[] {
  return rogues.map((r) => {
    const ssid = normSsid(r.essid);
    const spoofing = ssid !== "" && ourSsids.has(ssid.toLowerCase());
    const open = OPEN_SECURITY.has((r.security ?? "").toLowerCase());
    const rogueClass: RogueClass = spoofing ? (open ? "spoof_open" : "spoof") : "neighbour";
    return { ...r, ssid, spoofing, rogueClass };
  });
}

/**
 * One alert per neighbouring BSSID that is impersonating one of our SSIDs.
 * Keyed by BSSID so it stays one alert while the twin persists and clears when
 * it stops being seen (the poller re-queries each cycle).
 */
export function evaluateRogueApAlerts(
  rogues: UniFiRogueAp[],
  ourSsids: Set<string>,
): DesiredAlert[] {
  const out: DesiredAlert[] = [];
  for (const r of classifyRogues(rogues, ourSsids)) {
    if (!r.spoofing) continue;
    const open = r.rogueClass === "spoof_open";
    out.push({
      target: `rogueap:${r.bssid.toLowerCase()}`,
      targetName: `${r.ssid} @ ${r.bssid}`,
      type: "rogue_ap",
      severity: "error",
      message: `Neighbouring AP ${r.bssid} is broadcasting your SSID "${r.ssid}"${
        open ? " with NO encryption (evil-twin risk)" : ""
      }${r.channel ? ` on ch ${r.channel}` : ""}${r.oui ? ` — ${r.oui}` : ""}`,
      value: open ? "open" : r.security || "encrypted",
    });
  }
  return out;
}
