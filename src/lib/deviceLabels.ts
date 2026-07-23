/**
 * Display labels for UniFi hardware — one home instead of a copy per surface
 * (the dialog, the map, Network Status and the APs page all drifted their
 * own). `deviceType.ts` stays the place for the site NAMING-token labels
 * (AP/DN/AN/CN/CAN/UBB); this file labels what the controller itself reports.
 */

/** Controller `type` strings → human labels. */
export const TYPE_LABEL: Record<string, string> = {
  uap: "Access Point",
  usw: "Switch",
  udm: "Gateway",
  ugw: "Gateway",
  uxg: "Gateway",
  cn: "Core Node",
  ubb: "Building Bridge",
};

/** Radio band codes (radio_table_stats .radio) → band labels. */
export const RADIO_LABEL: Record<string, string> = { ng: "2.4G", na: "5G", "6e": "6G" };

/** Uptime seconds → "3d 4h" / "4h 12m" / "12m". */
export function formatUptime(s?: number): string {
  if (!s || s <= 0) return "-";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Epoch-seconds timestamp → "3h 12m ago" / "just now"; null when absent or
 * in the future (clock skew), so callers can simply hide the line. */
export function agoLabel(epochSec?: number): string | null {
  if (!epochSec || epochSec <= 0) return null;
  const s = Math.floor(Date.now() / 1000) - epochSec;
  if (s < 0) return null;
  if (s < 60) return "just now";
  return `${formatUptime(s)} ago`;
}
