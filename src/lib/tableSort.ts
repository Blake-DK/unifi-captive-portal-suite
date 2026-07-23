/**
 * Column-sort comparator shared by every sortable table: the client-side
 * data tables (useTableSort) and the DOM enhancer for server-rendered
 * tables (SortableTable). Pure so it stays unit-testable.
 *
 * Ordering rules: numbers compare numerically, including rendered strings
 * with a size/rate unit ("1.2 GB" > "900 MB") and en-GB dates
 * ("09/07/2026, 22:35"); everything else compares alphabetically with
 * numeric awareness ("Building 2" < "Building 10"). Empty cells ("", "-",
 * null) sort last in both directions.
 */

const UNIT_SCALE: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
  kbps: 1e3,
  mbps: 1e6,
  gbps: 1e9,
};

export function isEmptyCell(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" || t === "-" || t === "–";
  }
  return false;
}

/** en-GB toLocaleString forms: "09/07/2026" or "09/07/2026, 22:35[:14]". */
function ukDate(s: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s.trim());
  if (!m) return null;
  const [, d, mo, y, h, mi, se] = m;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h ?? 0),
    Number(mi ?? 0),
    Number(se ?? 0),
  ).getTime();
}

/** Best-effort numeric value of a cell, or null when it isn't number-like. */
export function numericCell(v: unknown): number | null {
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v !== "string") return null;
  const s = v.trim();
  const asDate = ukDate(s);
  if (asDate != null) return asDate;
  // Only a FULLY numeric cell counts ("1.2 GB", "-63 dBm", "42%"): a partial
  // match would make every 192.168.x.y IP parse as 192.168 and tie. Leading
  // arrows from rendered cells ("↓ 1.2 GB") don't block parsing.
  const m = /^[↓↑\s]*(-?\d+(?:[.,]\d+)?)\s*([a-z%]*)\s*$/i.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const scale = UNIT_SCALE[m[2]?.toLowerCase() ?? ""];
  return n * (scale ?? 1);
}

/** Ascending comparison of two cell values; wrap with the direction sign. */
export function compareCells(a: unknown, b: unknown): number {
  const na = numericCell(a);
  const nb = numericCell(b);
  if (na != null && nb != null) return na - nb;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Direction-aware comparison that keeps empty cells last either way.
 * `dir` is 1 for ascending, -1 for descending.
 */
export function compareCellsDirected(a: unknown, b: unknown, dir: 1 | -1): number {
  const ea = isEmptyCell(a);
  const eb = isEmptyCell(b);
  if (ea || eb) return ea && eb ? 0 : ea ? 1 : -1;
  return dir * compareCells(a, b);
}
