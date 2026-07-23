/**
 * Building-list helpers, kept free of prisma imports so they stay unit-testable
 * (Location.buildings is a newline-delimited textarea in the admin UI).
 */

export function splitBuildings(raw: string): string[] {
  return raw
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean);
}

/**
 * Which building names have guests typed that are NOT on the configured list?
 * Feeds the Locations tab's "add these to the list?" prompt for free-text
 * locations (and surfaces legacy strays on list locations after edits).
 * Case-insensitive against the configured lines; duplicates collapse to the
 * first-seen spelling; most-typed first so the likeliest real building tops
 * the list.
 */
export function unknownBuildings(
  configuredRaw: string,
  typed: { value: string | null | undefined; count: number }[],
): string[] {
  const known = new Set(splitBuildings(configuredRaw).map((b) => b.toLowerCase()));
  const seen = new Map<string, { label: string; count: number }>();
  for (const t of typed) {
    const label = t.value?.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (known.has(key)) continue;
    const entry = seen.get(key);
    if (entry) entry.count += t.count;
    else seen.set(key, { label, count: t.count });
  }
  return [...seen.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((e) => e.label);
}
