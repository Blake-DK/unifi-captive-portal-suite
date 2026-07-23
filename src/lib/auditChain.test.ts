import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chainHashOf,
  initialChainWalk,
  stableStringify,
  walkChain,
  type ChainRow,
} from "./auditChain.ts"; // explicit extension for Node's type-stripping runner

const row = (n: number, over: Partial<ChainRow> = {}): ChainRow => ({
  createdAt: new Date(1_700_000_000_000 + n * 1000),
  actorType: "admin",
  actor: "tester",
  action: `thing.${n}`,
  target: null,
  detail: { n },
  ip: "10.0.0.1",
  outcome: "success",
  ...over,
});

/** Build a well-formed chain of n rows starting from a null predecessor. */
function chain(n: number, startId = 1) {
  const rows: (ChainRow & { id: number; chainHash: string | null })[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) {
    const r = row(i);
    prev = chainHashOf(prev, r);
    rows.push({ ...r, id: startId + i, chainHash: prev });
  }
  return rows;
}

describe("stableStringify", () => {
  it("is key-order independent, like jsonb", () => {
    assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("normalizes like JSON.stringify (dates, undefined)", () => {
    const d = new Date("2026-07-11T12:00:00.000Z");
    assert.equal(stableStringify({ at: d }), `{"at":"2026-07-11T12:00:00.000Z"}`);
    assert.equal(stableStringify({ a: undefined, b: 1 }), `{"b":1}`);
  });
});

describe("walkChain", () => {
  it("verifies an intact chain, trusting the anchor", () => {
    const s = walkChain(initialChainWalk(), chain(5));
    assert.equal(s.firstBreakId, null);
    assert.equal(s.checked, 4); // the anchor itself is not recomputable
    assert.equal(s.unverifiable, 1);
  });

  it("flags an edited row", () => {
    const rows = chain(5);
    rows[2].actor = "attacker"; // stored hash no longer matches the content
    const s = walkChain(initialChainWalk(), rows);
    assert.equal(s.firstBreakId, rows[2].id);
  });

  it("flags a deleted row", () => {
    const rows = chain(5);
    rows.splice(2, 1); // row 3 now chains from a hash the walk never saw
    const s = walkChain(initialChainWalk(), rows);
    assert.equal(s.firstBreakId, 4);
  });

  it("treats pre-feature rows as unverifiable, not tampered", () => {
    const legacy = [
      { ...row(100), id: 1, chainHash: null },
      { ...row(101), id: 2, chainHash: null },
    ];
    const s = walkChain(initialChainWalk(), [...legacy, ...chain(3, 3)]);
    assert.equal(s.firstBreakId, null);
    assert.equal(s.unverifiable, 3); // two legacy + the anchor
    assert.equal(s.checked, 2);
  });

  it("flags a hashless row appearing after the anchor", () => {
    const rows = chain(3);
    rows.push({ ...row(9), id: 99, chainHash: null });
    const s = walkChain(initialChainWalk(), rows);
    assert.equal(s.firstBreakId, 99);
  });

  it("folds across pages exactly like one pass", () => {
    const rows = chain(10);
    let paged = initialChainWalk();
    paged = walkChain(paged, rows.slice(0, 4));
    paged = walkChain(paged, rows.slice(4, 7));
    paged = walkChain(paged, rows.slice(7));
    assert.deepEqual(paged, walkChain(initialChainWalk(), rows));
  });

  it("hash depends on the predecessor", () => {
    const r = row(1);
    assert.notEqual(chainHashOf(null, r), chainHashOf("aaaa", r));
  });
});
