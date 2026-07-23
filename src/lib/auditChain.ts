import { createHash } from "node:crypto";

/**
 * Hash-chained audit log. Every row stores
 * SHA-256(previous row's chainHash + canonical serialization of itself), so
 * silently editing or deleting a past row breaks every later link and a
 * verify pass can point at the first broken one.
 *
 * Honest scope (the roadmap's words): this detects silent tampering with
 * stored rows; it does not stop an attacker who can rewrite the whole chain.
 */

export type ChainRow = {
  createdAt: Date;
  actorType: string;
  actor: string;
  action: string;
  target: string | null;
  detail: unknown;
  ip: string | null;
  outcome: string;
};

/** JSON with recursively sorted object keys. Postgres jsonb does not preserve
 * key order, so the hash must not depend on it; normalizing through
 * JSON.stringify first also applies toJSON (Dates) and drops undefined,
 * matching exactly what gets stored. */
export function stableStringify(v: unknown): string {
  const normalized: unknown = v === undefined ? null : JSON.parse(JSON.stringify(v));
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
  return JSON.stringify(sort(normalized));
}

export function canonicalRow(r: ChainRow): string {
  return stableStringify([
    r.createdAt.toISOString(),
    r.actorType,
    r.actor,
    r.action,
    r.target ?? null,
    r.detail ?? null,
    r.ip ?? null,
    r.outcome,
  ]);
}

export function chainHashOf(prevHash: string | null, row: ChainRow): string {
  return createHash("sha256").update(`${prevHash ?? ""}\n${canonicalRow(row)}`).digest("hex");
}

export type ChainWalkState = {
  /** Stored hash of the last hashed row seen (the chain tip so far). */
  prevHash: string | null;
  /** Whether a hashed row has been seen yet (the anchor). */
  anchored: boolean;
  /** Rows whose hash was recomputed and matched. */
  checked: number;
  /** Pre-feature rows without a hash — reported, never treated as tampering. */
  unverifiable: number;
  /** First row whose link failed (or null while the chain holds). */
  firstBreakId: number | null;
};

export function initialChainWalk(): ChainWalkState {
  return { prevHash: null, anchored: false, checked: 0, unverifiable: 0, firstBreakId: null };
}

/**
 * Fold one page of rows (id ascending) into the walk. The first hashed row
 * is the anchor: retention may have pruned its predecessor, so its stored
 * hash is trusted rather than recomputed. Every later row must recompute
 * from the stored hash before it — a mismatch, or a hashless row after the
 * anchor, is a break.
 */
export function walkChain(
  state: ChainWalkState,
  rows: (ChainRow & { id: number; chainHash: string | null })[],
): ChainWalkState {
  const s = { ...state };
  for (const row of rows) {
    if (s.firstBreakId !== null) break;
    if (row.chainHash === null) {
      if (s.anchored) {
        s.firstBreakId = row.id; // post-anchor rows are always written hashed
      } else {
        s.unverifiable++;
      }
      continue;
    }
    if (!s.anchored) {
      s.anchored = true;
      s.prevHash = row.chainHash;
      s.unverifiable++; // the anchor itself cannot be recomputed
      continue;
    }
    if (chainHashOf(s.prevHash, row) !== row.chainHash) {
      s.firstBreakId = row.id;
      continue;
    }
    s.checked++;
    s.prevHash = row.chainHash;
  }
  return s;
}
