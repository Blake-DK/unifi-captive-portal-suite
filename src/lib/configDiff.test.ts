import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  diffLines,
  scrubSecrets,
  stableJson,
  summarizeChanges,
} from "./configDiff.ts"; // explicit extension for Node's type-stripping runner

describe("scrubSecrets", () => {
  it("fingerprints x_* fields anywhere in the tree, leaves the rest", () => {
    const out = scrubSecrets({
      wlans: [{ _id: "1", name: "Guest", x_passphrase: "hunter2", nested: { x_iapp_key: "k" } }],
    });
    const w = out.wlans[0] as Record<string, unknown>;
    assert.equal(w.name, "Guest");
    assert.match(String(w.x_passphrase), /^fp:[0-9a-f]{8}$/);
    assert.match(String((w.nested as Record<string, unknown>).x_iapp_key), /^fp:[0-9a-f]{8}$/);
  });

  it("a changed secret changes its fingerprint", () => {
    const a = scrubSecrets({ x_passphrase: "one" }) as { x_passphrase: string };
    const b = scrubSecrets({ x_passphrase: "two" }) as { x_passphrase: string };
    assert.notEqual(a.x_passphrase, b.x_passphrase);
  });
});

describe("stableJson", () => {
  it("is key-order independent", () => {
    assert.equal(stableJson({ b: 1, a: [{ d: 2, c: 3 }] }), stableJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});

describe("summarizeChanges", () => {
  const prev = {
    networks: [
      { _id: "n1", name: "LAN", vlan: 1 },
      { _id: "n2", name: "Guest", vlan: 420 },
    ],
    wlans: [{ _id: "w1", name: "Base" }],
  };

  it("counts added, removed and changed per collection", () => {
    const next = {
      networks: [
        { _id: "n1", name: "LAN", vlan: 10 }, // changed
        { _id: "n3", name: "IoT", vlan: 30 }, // added (n2 removed)
      ],
      wlans: [{ _id: "w1", name: "Base" }], // untouched
    };
    assert.deepEqual(summarizeChanges(prev, next), {
      networks: { added: 1, removed: 1, changed: 1 },
    });
  });

  it("a collection appearing or vanishing counts wholesale", () => {
    const next = { networks: prev.networks, wlans: [{ _id: "w1", name: "Base" }], portProfiles: [{ _id: "p1" }] };
    assert.deepEqual(summarizeChanges(prev, next), { portProfiles: { added: 1, removed: 0, changed: 0 } });
  });
});

describe("diffLines", () => {
  it("marks additions and deletions with collapsed context", () => {
    const a = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "old"].join("\n");
    const b = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "new"].join("\n");
    const d = diffLines(a, b);
    assert.deepEqual(d.filter((l) => l.type === "del").map((l) => l.text), ["old"]);
    assert.deepEqual(d.filter((l) => l.type === "add").map((l) => l.text), ["new"]);
    assert.ok(d.some((l) => /unchanged line/.test(l.text)), "long same-run collapses");
  });

  it("degrades to block del/add beyond the size bound", () => {
    const a = Array.from({ length: 30 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 30 }, (_, i) => `b${i}`).join("\n");
    const d = diffLines(a, b, 10);
    assert.equal(d.filter((l) => l.type === "del").length, 30);
    assert.equal(d.filter((l) => l.type === "add").length, 30);
  });
});
