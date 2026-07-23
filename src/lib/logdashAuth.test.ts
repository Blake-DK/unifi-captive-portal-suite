import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HANDOFF_TTL_MS, mintHandoff, safeRd, verifyHandoff } from "./logdashAuth.ts"; // explicit extension for Node's type-stripping runner

const SECRET = "test-secret";
const HOST = "logs.example.com";
const CLAIMS = { sub: "alex", role: "admin", rd: "/services?page=2" };

describe("logdash handoff token", () => {
  it("round-trips claims for the right host inside the TTL", () => {
    const t = mintHandoff(SECRET, HOST, CLAIMS, 1_000_000);
    assert.deepEqual(verifyHandoff(SECRET, t, HOST, 1_000_000 + HANDOFF_TTL_MS - 1), CLAIMS);
  });
  it("expires after the TTL", () => {
    const t = mintHandoff(SECRET, HOST, CLAIMS, 1_000_000);
    assert.equal(verifyHandoff(SECRET, t, HOST, 1_000_000 + HANDOFF_TTL_MS + 1), null);
  });
  it("is bound to the host it was minted for", () => {
    const t = mintHandoff(SECRET, HOST, CLAIMS, 1_000_000);
    assert.equal(verifyHandoff(SECRET, t, "evil.example.com", 1_000_000), null);
    // Case-insensitive on the happy path.
    assert.ok(verifyHandoff(SECRET, t, "LOGS.example.com", 1_000_000));
  });
  it("rejects tampered payloads and wrong secrets", () => {
    const t = mintHandoff(SECRET, HOST, CLAIMS, 1_000_000);
    const [body, sig] = [t.slice(0, t.lastIndexOf(".")), t.slice(t.lastIndexOf(".") + 1)];
    const forged = Buffer.from(JSON.stringify({ sub: "root", role: "admin", rd: "/", host: HOST, exp: 9e15 })).toString("base64url");
    assert.equal(verifyHandoff(SECRET, `${forged}.${sig}`, HOST, 1_000_000), null);
    assert.equal(verifyHandoff("other-secret", `${body}.${sig}`, HOST, 1_000_000), null);
    assert.equal(verifyHandoff(SECRET, "garbage", HOST, 1_000_000), null);
  });
});

describe("safeRd", () => {
  it("keeps same-host URLs as path+query and bare paths as-is", () => {
    assert.equal(safeRd(`https://${HOST}/a/b?x=1`, HOST), "/a/b?x=1");
    assert.equal(safeRd("/plain/path", HOST), "/plain/path");
  });
  it("clamps foreign hosts, protocol-relative URLs, and garbage to /", () => {
    assert.equal(safeRd("https://evil.example.com/", HOST), "/");
    assert.equal(safeRd("//evil.example.com/x", HOST), "/");
    assert.equal(safeRd("javascript:alert(1)", HOST), "/");
    assert.equal(safeRd("", HOST), "/");
    assert.equal(safeRd(null, HOST), "/");
  });
});
