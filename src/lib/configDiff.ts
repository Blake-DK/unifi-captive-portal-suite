/**
 * Pure diff helpers for the controller config history — no local imports so
 * Node's type-stripping test runner loads this directly. Bundles are
 * Record<collection, row[]> where rows usually carry a Mongo `_id`.
 */

export type ChangeSummary = Record<string, { added: number; removed: number; changed: number }>;

/**
 * UniFi marks sensitive fields with an `x_` prefix (x_passphrase,
 * x_iapp_key, …). Snapshots replace their values with a short fingerprint:
 * a changed secret still shows as a change, but no secret is ever stored.
 * The fingerprint is FNV-1a (not crypto — this hides content in the
 * snapshot store, it is not a password hash).
 */
export function scrubSecrets<T>(v: T): T {
  const fingerprint = (s: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `fp:${h.toString(16).padStart(8, "0")}`;
  };
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x !== null && typeof x === "object") {
      return Object.fromEntries(
        Object.entries(x as Record<string, unknown>).map(([k, val]) =>
          k.startsWith("x_") ? [k, fingerprint(JSON.stringify(val))] : [k, walk(val)],
        ),
      );
    }
    return x;
  };
  return walk(v) as T;
}

/** JSON with recursively sorted keys, so semantically-equal bundles hash and
 * diff identically regardless of controller field order. */
export function stableJson(v: unknown, indent = 0): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x !== null && typeof x === "object") {
      return Object.fromEntries(
        Object.entries(x as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, sort(val)]),
      );
    }
    return x;
  };
  return JSON.stringify(sort(v), null, indent || undefined);
}

const rowsOf = (bundle: Record<string, unknown>, key: string): Record<string, unknown>[] => {
  const v = bundle[key];
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
};

const idOf = (row: Record<string, unknown>, idx: number): string =>
  typeof row._id === "string" ? row._id : `#${idx}`;

/** Per-collection added/removed/changed counts between two bundles, matching
 * rows by `_id` (positional for the rare row without one). */
export function summarizeChanges(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): ChangeSummary {
  const out: ChangeSummary = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const a = new Map(rowsOf(prev, key).map((r, i) => [idOf(r, i), r]));
    const b = new Map(rowsOf(next, key).map((r, i) => [idOf(r, i), r]));
    let added = 0;
    let removed = 0;
    let changed = 0;
    for (const [id, row] of b) {
      const old = a.get(id);
      if (!old) added++;
      else if (stableJson(old) !== stableJson(row)) changed++;
    }
    for (const id of a.keys()) if (!b.has(id)) removed++;
    if (added || removed || changed) out[key] = { added, removed, changed };
  }
  return out;
}

export type DiffLine = { type: "same" | "add" | "del"; text: string };

/** Line-level LCS diff, bounded: beyond `maxLines` per side it degrades to
 * whole-block del/add rather than blowing up quadratically. Context lines
 * are collapsed to 2 around each change. */
export function diffLines(aText: string, bText: string, maxLines = 2000): DiffLine[] {
  const a = aText.split("\n");
  const b = bText.split("\n");
  if (a.length > maxLines || b.length > maxLines) {
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  }
  // LCS table.
  const m = a.length;
  const n = b.length;
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const full: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      full.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      full.push({ type: "del", text: a[i++] });
    } else {
      full.push({ type: "add", text: b[j++] });
    }
  }
  while (i < m) full.push({ type: "del", text: a[i++] });
  while (j < n) full.push({ type: "add", text: b[j++] });

  // Collapse long same-runs to 2 lines of context each side of a change.
  const out: DiffLine[] = [];
  for (let k = 0; k < full.length; k++) {
    if (full[k].type !== "same") {
      out.push(full[k]);
      continue;
    }
    let run = k;
    while (run < full.length && full[run].type === "same") run++;
    const len = run - k;
    if (len <= 5) {
      out.push(...full.slice(k, run));
    } else {
      if (out.length > 0) out.push(...full.slice(k, k + 2));
      if (run < full.length) {
        if (len > 4) out.push({ type: "same", text: `… ${len - 4} unchanged line(s) …` });
        out.push(...full.slice(run - 2, run));
      }
    }
    k = run - 1;
  }
  return out;
}
