/**
 * Shared per-WAN presentation so both WAN links read the same everywhere
 * (dashboard, metrics, network review). Colors are the theme-aware chart
 * vars — visible in light and dark — keyed by WAN so wan1/wan2 keep a stable
 * identity across the suite.
 */

const WAN_COLORS: Record<string, string> = {
  wan1: "var(--chart-1)",
  wan2: "var(--chart-4)",
};

/** Stable chart color for a WAN key (falls back for any extra/unknown key). */
export function wanColor(key: string): string {
  return WAN_COLORS[key] ?? "var(--chart-5)";
}

/** Display label: the controller's WAN name if set, else WAN/WAN2 from the key. */
export function wanLabel(key: string, name?: string | null): string {
  if (name && name.trim()) return name.trim();
  return key === "wan1" ? "WAN" : key === "wan2" ? "WAN2" : key.toUpperCase();
}
