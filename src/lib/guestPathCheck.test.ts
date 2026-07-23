import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessGuestPath, foreignAddrs } from "./guestPathCheck.ts";

const OWN = ["172.20.0.3", "172.21.0.3", "127.0.0.1"];

describe("foreignAddrs", () => {
  it("drops loopback (incl. 127.0.1.1 and mapped forms) and own addresses", () => {
    assert.deepEqual(
      foreignAddrs(["127.0.1.1", "::1", "::ffff:127.0.0.1", "172.20.0.3", "172.19.0.9"], OWN),
      ["172.19.0.9"],
    );
  });
});

describe("assessGuestPath", () => {
  it("passes when the name does not resolve (the correct isolated state)", () => {
    const v = assessGuestPath({ resolved: [], resolveError: "ENOTFOUND portal", ownAddrs: OWN });
    assert.equal(v.ok, true);
    assert.equal(v.warn, undefined);
    assert.match(v.detail, /does not resolve/);
  });
  it("passes on the host self-alias case (portal → 127.0.1.1, the live false alarm)", () => {
    const v = assessGuestPath({ resolved: ["127.0.1.1"], ownAddrs: OWN });
    assert.equal(v.ok, true);
    assert.equal(v.warn, undefined);
    assert.match(v.detail, /self-alias/);
  });
  it("passes when the name resolves only to this container's own address", () => {
    const v = assessGuestPath({ resolved: ["172.20.0.3"], ownAddrs: OWN });
    assert.equal(v.ok, true);
  });
  it("fails when a foreign address answers HTTP — a real shared network", () => {
    const v = assessGuestPath({
      resolved: ["172.19.0.9"],
      ownAddrs: OWN,
      probedAddr: "172.19.0.9",
      httpStatus: 200,
    });
    assert.equal(v.ok, false);
    assert.match(v.detail, /172\.19\.0\.9:3000 \(HTTP 200\)/);
  });
  it("fails even when loopback answers accompany the foreign one", () => {
    const v = assessGuestPath({
      resolved: ["127.0.1.1", "172.19.0.9"],
      ownAddrs: OWN,
      probedAddr: "172.19.0.9",
      httpStatus: 404,
    });
    assert.equal(v.ok, false);
  });
  it("warns (but passes) on a search-domain artifact nothing answers on", () => {
    const v = assessGuestPath({
      resolved: ["10.90.0.50"],
      ownAddrs: OWN,
      probedAddr: "10.90.0.50",
      httpError: "connect ECONNREFUSED 10.90.0.50:3000",
    });
    assert.equal(v.ok, true);
    assert.equal(v.warn, true);
    assert.match(v.detail, /search-domain/);
  });
});
