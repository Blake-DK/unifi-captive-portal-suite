import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.ADMIN_SECRET ??= "unit-test-secret-0123456789";

const {
  allowedSponsor,
  createSponsorToken,
  hashSponsorToken,
  parseSponsorList,
  createWatchToken,
  verifyWatchToken,
  renderSponsorEmail,
} = await import("./sponsor.ts"); // explicit extension for Node's type-stripping runner

describe("allowedSponsor", () => {
  const opts = { emails: "poc@unit.mil\nFrontDesk@unit.mil\n", domains: "unit.mil\n*@guard.mil" };

  it("accepts curated list entries case-insensitively", () => {
    assert.equal(allowedSponsor("POC@unit.mil", opts), true);
    assert.equal(allowedSponsor("frontdesk@unit.mil", opts), true);
  });

  it("accepts any address on an allowed domain, with or without the *@ prefix", () => {
    assert.equal(allowedSponsor("anyone@unit.mil", opts), true);
    assert.equal(allowedSponsor("someone@guard.mil", opts), true);
  });

  it("rejects other domains, sub-domain tricks and junk", () => {
    assert.equal(allowedSponsor("body@evil.com", opts), false);
    assert.equal(allowedSponsor("body@unit.mil.evil.com", opts), false);
    assert.equal(allowedSponsor("not-an-email", opts), false);
    assert.equal(allowedSponsor("", opts), false);
  });

  it("rejects everything when nothing is configured", () => {
    assert.equal(allowedSponsor("poc@unit.mil", { emails: "", domains: "" }), false);
  });
});

describe("sponsor tokens", () => {
  it("hashes round-trip and tokens are unique", () => {
    const a = createSponsorToken();
    const b = createSponsorToken();
    assert.notEqual(a.token, b.token);
    assert.equal(hashSponsorToken(a.token), a.tokenHash);
    assert.notEqual(a.tokenHash, b.tokenHash);
  });

  it("watch tokens verify and reject tampering", async () => {
    const t = await createWatchToken(42);
    assert.equal(await verifyWatchToken(t), 42);
    assert.equal(await verifyWatchToken(t.replace("42", "43")), null);
    assert.equal(await verifyWatchToken("junk"), null);
  });
});

describe("renderSponsorEmail", () => {
  it("carries the requester identity and the link", () => {
    const m = renderSponsorEmail({
      brand: "Base WiFi",
      firstName: "Evie",
      lastName: "<Tester>",
      phone: "5551234567",
      mac: "aa:bb:cc:11:22:33",
      locationName: null,
      approveUrl: "https://x/sponsor?token=abc",
    });
    assert.match(m.subject, /Evie/);
    assert.match(m.text, /5551234567/);
    assert.match(m.text, /https:\/\/x\/sponsor\?token=abc/);
    assert.ok(m.html.includes("&lt;Tester&gt;"), "html-escapes the name");
  });
});

describe("parseSponsorList", () => {
  it("trims, lowercases and drops blanks", () => {
    assert.deepEqual(parseSponsorList(" A@B.mil \n\n c@d.mil\n"), ["a@b.mil", "c@d.mil"]);
  });
});
