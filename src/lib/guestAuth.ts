/**
 * Guest self-service session + magic-link authentication.
 *
 * Separate from admin auth (src/lib/auth.ts) because the two carry different
 * shaped identities: admin's cookie is a boolean "is admin" flag, guest's
 * must carry *which phone number* the session is scoped to, so every device
 * query/mutation can be checked server-side against it.
 */
import type { NextRequest } from "next/server";
import { hmacSignHex, hmacVerify } from "./crypto";
import { adminSecretKey } from "./auth";

const GUEST_COOKIE_NAME = "guest_session";
const GUEST_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAGIC_LINK_TTL_MS = 20 * 60 * 1000; // 20 min — a one-shot bridge from the
                                            // captive webview to the real browser,
                                            // not a durable login

/**
 * Derives a domain-separated key from ADMIN_SECRET by default so most
 * deployments don't need a separate setting. Honors GUEST_SESSION_SECRET in
 * .env if an operator wants full isolation from the admin secret.
 */
async function guestSecret(): Promise<string> {
  return process.env.GUEST_SESSION_SECRET || (await hmacSignHex(adminSecretKey(), "guest-session-v1"));
}

export async function createGuestSessionToken(phoneDigits: string): Promise<string> {
  const issuedAt = Date.now().toString();
  const payload = `${phoneDigits}.${issuedAt}`;
  const sig = await hmacSignHex(await guestSecret(), payload);
  return `${payload}.${sig}`;
}

export async function verifyGuestSessionToken(
  token: string | undefined | null,
): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [phoneDigits, issuedAt, sigHex] = parts;
  const ts = parseInt(issuedAt, 10);
  if (!phoneDigits || !Number.isFinite(ts)) return null;
  if (Date.now() - ts > GUEST_SESSION_TTL_MS) return null;
  const ok = await hmacVerify(await guestSecret(), `${phoneDigits}.${issuedAt}`, sigHex);
  return ok ? phoneDigits : null;
}

/**
 * A short-lived, replayable-within-window token (not single-use — it only
 * grants what phone+lastname login already grants, never re-runs UniFi
 * authorization, so consumption-tracking isn't justified). The signed
 * message is purpose-prefixed so it can never be replayed as a session
 * cookie value or vice versa, despite sharing the same derived key.
 */
export async function createMagicLinkToken(phoneDigits: string): Promise<string> {
  const issuedAt = Date.now().toString();
  const sig = await hmacSignHex(await guestSecret(), `magic.${phoneDigits}.${issuedAt}`);
  return `${phoneDigits}.${issuedAt}.${sig}`;
}

export async function verifyMagicLinkToken(
  token: string | undefined | null,
): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [phoneDigits, issuedAt, sigHex] = parts;
  const ts = parseInt(issuedAt, 10);
  if (!phoneDigits || !Number.isFinite(ts)) return null;
  if (Date.now() - ts > MAGIC_LINK_TTL_MS) return null;
  const ok = await hmacVerify(await guestSecret(), `magic.${phoneDigits}.${issuedAt}`, sigHex);
  return ok ? phoneDigits : null;
}

const VERIFY_TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // 72h — email links live longer
                                                  // than magic links; the guest may
                                                  // open the mail from anywhere

/**
 * Email-verification token: proves the holder received the email sent to
 * `email` for `phone`. Emails can contain dots, so the address is
 * base64url-encoded to keep the dot-separated token format unambiguous.
 * Purpose-prefixed like the magic link so tokens can't cross-play.
 */
export async function createEmailVerifyToken(
  phoneDigits: string,
  email: string,
): Promise<string> {
  const emailB64 = Buffer.from(email.toLowerCase()).toString("base64url");
  const issuedAt = Date.now().toString();
  const sig = await hmacSignHex(await guestSecret(), `verify.${phoneDigits}.${emailB64}.${issuedAt}`);
  return `${phoneDigits}.${emailB64}.${issuedAt}.${sig}`;
}

export async function verifyEmailVerifyToken(
  token: string | undefined | null,
): Promise<{ phone: string; email: string } | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [phoneDigits, emailB64, issuedAt, sigHex] = parts;
  const ts = parseInt(issuedAt, 10);
  if (!phoneDigits || !emailB64 || !Number.isFinite(ts)) return null;
  if (Date.now() - ts > VERIFY_TOKEN_TTL_MS) return null;
  const ok = await hmacVerify(
    await guestSecret(),
    `verify.${phoneDigits}.${emailB64}.${issuedAt}`,
    sigHex,
  );
  if (!ok) return null;
  try {
    return { phone: phoneDigits, email: Buffer.from(emailB64, "base64url").toString() };
  } catch {
    return null;
  }
}

export const GUEST_COOKIE = GUEST_COOKIE_NAME;
export const GUEST_COOKIE_MAX_AGE = GUEST_SESSION_TTL_MS / 1000;

/** Reads + verifies the guest session cookie off a request; null if absent/invalid. */
export async function requireGuestPhone(req: NextRequest): Promise<string | null> {
  return verifyGuestSessionToken(req.cookies.get(GUEST_COOKIE)?.value);
}
