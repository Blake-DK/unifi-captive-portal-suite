import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareSemver, parseSemver } from "./semver.ts"; // explicit extension for Node's type-stripping runner

describe("parseSemver", () => {
  it("parses plain and v-prefixed versions", () => {
    assert.deepEqual(parseSemver("1.26.0"), [1, 26, 0]);
    assert.deepEqual(parseSemver("v2.0.13"), [2, 0, 13]);
  });
  it("rejects anything that isn't plain X.Y.Z", () => {
    assert.equal(parseSemver("1.2"), null);
    assert.equal(parseSemver("1.2.3-beta.1"), null);
    assert.equal(parseSemver("dev"), null);
  });
});

describe("compareSemver", () => {
  it("orders numerically per segment (not lexically)", () => {
    assert.equal(compareSemver("1.9.0", "1.10.0"), -1);
    assert.equal(compareSemver("1.26.0", "v1.25.3"), 1);
    assert.equal(compareSemver("v1.26.0", "1.26.0"), 0);
    assert.equal(compareSemver("2.0.0", "1.99.99"), 1);
  });
  it("returns null when either side is unparseable", () => {
    assert.equal(compareSemver("dev", "1.0.0"), null);
    assert.equal(compareSemver("1.0.0", "latest"), null);
  });
});
