import { createHash } from "crypto";

/**
 * Microsoft 365 mail via Graph `sendMail` — the "cheapest possible" Exchange
 * Online integration: a FREE shared mailbox as sender (no license), an Entra
 * app registration with application `Mail.Send`, and an
 * ApplicationAccessPolicy restricting the app to that ONE mailbox
 * (docs/M365-EMAIL.md walks through the setup). No SMTP AUTH involved —
 * basic auth is retired — and no SDK: two fetch calls.
 *
 * Kept free of prisma/config imports so the token-cache and error-mapping
 * logic stays loadable by the node --test runner as pure functions.
 */

export type M365Config = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Shared-mailbox address the mail is sent from (and saved to Sent Items). */
  sender: string;
};

// --- token cache (pure pieces exported for tests) ----------------------------

export type TokenCacheEntry = { key: string; token: string; expiresAt: number };

/** Any credential edit must invalidate the cache — the secret is hashed into
 * the key rather than stored. */
export function tokenCacheKey(cfg: M365Config): string {
  const secretHash = createHash("sha256").update(cfg.clientSecret).digest("hex").slice(0, 8);
  return `${cfg.tenantId}|${cfg.clientId}|${secretHash}`;
}

/** 2-minute early-expiry margin absorbs clock skew and slow requests. */
export const TOKEN_SKEW_MS = 120_000;

export function cacheEntryFromTokenResponse(
  key: string,
  json: { access_token?: string; expires_in?: number },
  now: number,
): TokenCacheEntry | null {
  if (!json.access_token || !Number.isFinite(json.expires_in)) return null;
  return {
    key,
    token: json.access_token,
    expiresAt: now + (json.expires_in as number) * 1000 - TOKEN_SKEW_MS,
  };
}

export function cacheGet(entry: TokenCacheEntry | null, key: string, now: number): string | null {
  return entry && entry.key === key && entry.expiresAt > now ? entry.token : null;
}

let tokenCache: TokenCacheEntry | null = null;

/** Test/reset hook and the 401-retry cache-buster. */
export function clearM365TokenCache(): void {
  tokenCache = null;
}

// --- error mapping (pure) -----------------------------------------------------

/** Turn Graph / Entra error responses into operator-actionable messages. */
export function mapGraphError(status: number, body: unknown, retryAfter?: string | null): string {
  const b = (body ?? {}) as {
    error?: { code?: string; message?: string } | string;
    error_description?: string;
  };
  const desc = typeof b.error_description === "string" ? b.error_description : "";
  const code =
    typeof b.error === "string" ? b.error : typeof b.error?.code === "string" ? b.error.code : "";
  const message = typeof b.error === "object" && b.error?.message ? b.error.message : "";

  if (desc.includes("AADSTS7000215")) {
    return "Client secret is invalid or expired — create a new secret in the app registration and save it here.";
  }
  if (desc.includes("AADSTS700016")) {
    return "Client ID not found in this tenant — check the Application (client) ID.";
  }
  if (desc.includes("AADSTS90002") || (status === 400 && desc.toLowerCase().includes("tenant"))) {
    return "Tenant ID not found — check the Directory (tenant) ID.";
  }
  if (status === 429) {
    return `Microsoft Graph throttled the request${retryAfter ? ` — retry after ${retryAfter}s` : ""}.`;
  }
  if (code === "ErrorAccessDenied" || status === 403) {
    // Keep Microsoft's own wording: it distinguishes missing consent from an
    // ApplicationAccessPolicy denial, which the canned advice cannot.
    const raw = [code, message].filter(Boolean).join(": ").slice(0, 200);
    return `Access denied — grant the app the Mail.Send APPLICATION permission with admin consent, and check the ApplicationAccessPolicy includes this mailbox.${raw ? ` Microsoft's response: ${raw}` : ""}`;
  }
  if (code === "ErrorSendAsDenied") {
    return "Not allowed to send as this mailbox — the ApplicationAccessPolicy may scope the app to a different mailbox, or the address is wrong.";
  }
  if (code === "ErrorInvalidUser" || code === "ResourceNotFound" || status === 404) {
    return "Sender mailbox not found — check the shared-mailbox address.";
  }
  const detail = desc || message || code || "unknown error";
  return `${status}: ${detail}`.slice(0, 300);
}

// --- payload (pure) -----------------------------------------------------------

/** Graph sendMail body. `saveToSentItems` is deliberate: the shared mailbox's
 * Sent Items folder doubles as the send audit trail beside EmailLog. Graph
 * takes ONE body — the plaintext alternative the SMTP path sends is dropped
 * (Outlook derives its own text rendering). */
export function buildSendMailPayload(opts: { to: string; subject: string; html: string }) {
  return {
    message: {
      subject: opts.subject,
      body: { contentType: "HTML", content: opts.html },
      toRecipients: [{ emailAddress: { address: opts.to } }],
    },
    saveToSentItems: true,
  };
}

// --- network calls -------------------------------------------------------------

async function fetchToken(cfg: M365Config): Promise<string> {
  const key = tokenCacheKey(cfg);
  const cached = cacheGet(tokenCache, key, Date.now());
  if (cached) return cached;

  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  );
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Microsoft 365 sign-in failed — ${mapGraphError(res.status, json)}`);
  }
  const entry = cacheEntryFromTokenResponse(key, json, Date.now());
  if (!entry) throw new Error("Microsoft 365 sign-in returned no usable token.");
  tokenCache = entry;
  return entry.token;
}

async function postSendMail(cfg: M365Config, token: string, payload: unknown): Promise<Response> {
  return fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.sender)}/sendMail`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

/** Send one message; throws with an operator-actionable message on failure. */
export async function sendViaM365(
  cfg: M365Config,
  opts: { to: string; subject: string; html: string },
): Promise<void> {
  const payload = buildSendMailPayload(opts);
  let token = await fetchToken(cfg);
  let res = await postSendMail(cfg, token, payload);
  if (res.status === 401) {
    // Token revoked/skewed under us — one fresh-token retry.
    clearM365TokenCache();
    token = await fetchToken(cfg);
    res = await postSendMail(cfg, token, payload);
  }
  if (res.status === 202) return; // Graph's success for sendMail
  const body = await res.json().catch(() => ({}));
  throw new Error(`Microsoft 365 send failed — ${mapGraphError(res.status, body, res.headers.get("retry-after"))}`);
}

/** Token-acquisition-only probe for the settings page's Check button. A pass
 * proves tenant/client/secret; mailbox and policy problems only surface on a
 * real send — follow with "Send test email". */
export async function testM365Connection(
  cfg: M365Config,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    clearM365TokenCache();
    await fetchToken(cfg);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
