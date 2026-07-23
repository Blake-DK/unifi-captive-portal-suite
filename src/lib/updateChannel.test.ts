import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveChannel } from "./updateChannel.ts"; // explicit extension for Node's type-stripping runner

describe("resolveChannel", () => {
  it("keeps the setting when it matches the running line", () => {
    assert.equal(resolveChannel("stable", "stable", true), "stable");
    assert.equal(resolveChannel("develop", "develop", true), "develop");
    assert.equal(resolveChannel("nightly", "nightly", true), "nightly");
  });
  it("a develop or nightly image always overrides a mismatched setting", () => {
    assert.equal(resolveChannel("stable", "nightly", true), "nightly");
    assert.equal(resolveChannel("stable", "develop", true), "develop");
    assert.equal(resolveChannel("nightly", "develop", true), "develop");
    // Channel bakes independently of the SHA — override holds either way.
    assert.equal(resolveChannel("stable", "nightly", false), "nightly");
  });
  it("a CI-built stable image overrides a leftover develop/nightly setting", () => {
    // The bug this file exists for: a host moved from nightly to stable
    // kept comparing its release commit against the nightly branch head,
    // which can never match, so the sidebar showed a phantom update.
    assert.equal(resolveChannel("nightly", "stable", true), "stable");
    assert.equal(resolveChannel("develop", "stable", true), "stable");
  });
  it("local builds have no line of their own — the setting wins", () => {
    assert.equal(resolveChannel("nightly", "stable", false), "nightly");
    assert.equal(resolveChannel("develop", "stable", false), "develop");
  });
});
