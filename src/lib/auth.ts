/**
 * Admin panel authentication.
 * Uses Web Crypto API (globalThis.crypto.subtle) for Edge Runtime compatibility.
 */
import { enc, hmacSignHex, hmacVerify } from "./crypto";

const COOKIE_NAME = "admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function secretKey(): string {
  const s = process.env.ADMIN_SECRET;
  if (!s || s.length < 16) throw new Error("ADMIN_SECRET missing or too short");
  return s;
}

/** Exposed so guest-session auth can derive a domain-separated key from it. */
export const adminSecretKey = secretKey;

/**
 * Least-privilege roles:
 *  - "admin"    — everything, including system settings and account management
 *  - "operator" — day-to-day guest management (create/edit/revoke/delete
 *                 guests and devices); no settings, no accounts
 *  - "monitor"  — read-only
 * The privacy-sensitive traffic view is a separate per-account grant
 * (AdminUser.canViewTraffic), independent of role.
 */
export type AdminRole = "admin" | "operator" | "monitor";
/** issuedAt (ms) rides along so guards can reject tokens older than a
 * password change (AdminUser.sessionsValidFrom). */
export type AdminSession = { sub: string; role: AdminRole; issuedAt: number };

/**
 * Setup/recovery session, issued while NO admin-role account exists — full
 * admin, but the proxy pins it to the account-creation page until a personal
 * admin account is made.
 */
export const SETUP_ADMIN_SUB = "setup";
/**
 * Subs that don't correspond to an AdminUser row and can't be account names.
 * "legacy" was the removed shared-password session; keep it reserved so old
 * discussions/bookmarks/tokens can never collide with a real account.
 */
export const SENTINEL_SUBS: readonly string[] = ["legacy", SETUP_ADMIN_SUB];

/**
 * Token: `2.<sub>.<role>.<issuedAt>.<sig>`. Dots are safe separators because
 * usernames are restricted to [a-z0-9_-] at account creation. v1 tokens
 * (issuedAt.sig, no identity) are simply invalid — holders re-login.
 */
export async function createSessionToken(sub: string, role: AdminRole): Promise<string> {
  const payload = `2.${sub}.${role}.${Date.now()}`;
  const sig = await hmacSignHex(secretKey(), payload);
  return `${payload}.${sig}`;
}

export async function verifyAdminSession(
  token: string | undefined | null,
): Promise<AdminSession | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [version, sub, role, issuedAt, sigHex] = parts;
  if (version !== "2" || !sub) return null;
  if (role !== "admin" && role !== "operator" && role !== "monitor") return null;

  // Shared-password ("legacy") sessions no longer exist — kill live ones too.
  if (sub === "legacy") return null;

  const ts = parseInt(issuedAt, 10);
  if (!Number.isFinite(ts) || Date.now() - ts > SESSION_TTL_MS) return null;

  const ok = await hmacVerify(secretKey(), `${version}.${sub}.${role}.${issuedAt}`, sigHex);
  return ok ? { sub, role, issuedAt: ts } : null;
}

/**
 * Timing-safe check of the setup/recovery password. Env-only by design: it is
 * not a shareable login — it exists solely to create the first admin account
 * (or recover after the last one is lost) and never grants steady-state access.
 */
export async function checkSetupPassword(password: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      enc("pw-compare"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    const [ha, hb] = await Promise.all([
      crypto.subtle.sign("HMAC", key, enc(password)),
      crypto.subtle.sign("HMAC", key, enc(expected)),
    ]);
    const a = new Uint8Array(ha);
    const b = new Uint8Array(hb);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  } catch {
    return false;
  }
}

export const ADMIN_COOKIE = COOKIE_NAME;
export const ADMIN_COOKIE_MAX_AGE = SESSION_TTL_MS / 1000;
