import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TOKEN_SKEW_MS,
  buildSendMailPayload,
  cacheEntryFromTokenResponse,
  cacheGet,
  mapGraphError,
  tokenCacheKey,
} from "./m365Mail.ts"; // explicit extension for Node's type-stripping runner

const cfg = { tenantId: "t-1", clientId: "c-1", clientSecret: "shh", sender: "portal@x.com" };

describe("buildSendMailPayload", () => {
  it("shapes the Graph sendMail body with HTML content and Sent Items save", () => {
    const p = buildSendMailPayload({ to: "a@b.com", subject: "Hi", html: "<b>x</b>" });
    assert.equal(p.saveToSentItems, true);
    assert.equal(p.message.body.contentType, "HTML");
    assert.deepEqual(p.message.toRecipients, [{ emailAddress: { address: "a@b.com" } }]);
  });
});

describe("token cache", () => {
  const now = 1_000_000;

  it("applies the early-expiry skew margin", () => {
    const e = cacheEntryFromTokenResponse("k", { access_token: "tok", expires_in: 3599 }, now)!;
    assert.equal(e.expiresAt, now + 3599_000 - TOKEN_SKEW_MS);
    assert.equal(cacheGet(e, "k", e.expiresAt - 1), "tok");
    assert.equal(cacheGet(e, "k", e.expiresAt), null);
  });

  it("misses when any credential changed (key mismatch)", () => {
    const e = cacheEntryFromTokenResponse(tokenCacheKey(cfg), { access_token: "tok", expires_in: 3600 }, now)!;
    assert.equal(cacheGet(e, tokenCacheKey(cfg), now + 1), "tok");
    assert.equal(cacheGet(e, tokenCacheKey({ ...cfg, clientSecret: "rotated" }), now + 1), null);
  });

  it("rejects token responses without a usable token", () => {
    assert.equal(cacheEntryFromTokenResponse("k", {}, now), null);
    assert.equal(cacheEntryFromTokenResponse("k", { access_token: "tok" }, now), null);
  });
});

describe("mapGraphError", () => {
  it("maps the common Entra sign-in failures to actionable text", () => {
    assert.match(
      mapGraphError(401, { error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret" }),
      /secret is invalid or expired/,
    );
    assert.match(
      mapGraphError(400, { error_description: "AADSTS700016: app not found" }),
      /Client ID not found/,
    );
    assert.match(
      mapGraphError(400, { error_description: "AADSTS90002: tenant not found" }),
      /Tenant ID not found/,
    );
  });

  it("maps Graph send failures: consent, mailbox scope, bad address, throttling", () => {
    assert.match(mapGraphError(403, { error: { code: "ErrorAccessDenied", message: "denied" } }), /Mail\.Send/);
    // The raw Graph code + message ride along so the operator sees Microsoft's actual objection.
    assert.match(
      mapGraphError(403, { error: { code: "ErrorAccessDenied", message: "denied" } }),
      /Microsoft's response: ErrorAccessDenied: denied/,
    );
    assert.match(mapGraphError(403, {}), /mailbox\.$/);
    assert.match(mapGraphError(400, { error: { code: "ErrorSendAsDenied", message: "no" } }), /ApplicationAccessPolicy/);
    assert.match(mapGraphError(404, { error: { code: "ErrorInvalidUser", message: "no" } }), /mailbox not found/i);
    assert.match(mapGraphError(429, {}, "17"), /retry after 17s/);
  });

  it("falls back to status + detail for unknown errors", () => {
    assert.match(mapGraphError(500, { error: { code: "Weird", message: "boom" } }), /500: .*boom|500: Weird/);
    assert.match(mapGraphError(502, {}), /502: unknown error/);
  });
});
