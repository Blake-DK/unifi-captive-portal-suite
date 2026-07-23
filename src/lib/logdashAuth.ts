import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Cross-host session handoff for the Traefik log dashboard. The admin
 * session cookie is scoped to the admin host, so the first visit to the
 * dashboard's hostname bounces through the admin host once:
 *
 *   browser → https://logs.example.com/…        forwardAuth: no cookie
 *     302 → admin host /api/logdash-auth/start  (admin cookie present here;
 *                                                /admin/login first if not)
 *     302 → https://logs.example.com/__portal_auth?token=…   (this handoff)
 *     forwardAuth verifies the token, sets the admin-session cookie FOR THE
 *     DASHBOARD HOST, 302 back to the originally requested path.
 *
 * The token is an HMAC-signed, short-lived (60s), host-bound statement
 * "this admin session may be re-issued on that host". Same secret as the
 * session cookie itself, so rotating ADMIN_SECRET kills handoffs and
 * sessions together. Not single-use — the 60s window plus host binding
 * bounds replay to what a stolen-in-flight URL could already do (the
 * redirect target only ever appears over HTTPS).
 */

export const HANDOFF_PATH = "/__portal_auth";
export const HANDOFF_TTL_MS = 60_000;

export type HandoffClaims = {
  sub: string;
  role: string;
  /** Path+query on the dashboard host to land on after the cookie is set. */
  rd: string;
};

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function sign(secret: string, payload: string): string {
  return createHmac("sha256", `logdash-handoff:${secret}`).update(payload).digest("base64url");
}

export function mintHandoff(
  secret: string,
  host: string,
  claims: HandoffClaims,
  now = Date.now(),
): string {
  const body = b64u(
    JSON.stringify({ ...claims, host: host.toLowerCase(), exp: now + HANDOFF_TTL_MS, jti: randomBytes(8).toString("hex") }),
  );
  return `${body}.${sign(secret, body)}`;
}

export function verifyHandoff(
  secret: string,
  token: string,
  host: string,
  now = Date.now(),
): HandoffClaims | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(secret, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      sub?: unknown;
      role?: unknown;
      rd?: unknown;
      host?: unknown;
      exp?: unknown;
    };
    if (typeof c.sub !== "string" || !c.sub || typeof c.role !== "string") return null;
    if (typeof c.exp !== "number" || now > c.exp) return null;
    if (typeof c.host !== "string" || c.host !== host.toLowerCase()) return null;
    return { sub: c.sub, role: c.role, rd: typeof c.rd === "string" ? c.rd : "/" };
  } catch {
    return null;
  }
}

/**
 * Clamp a return-to value to a path on the dashboard host — the rd rides
 * through a browser redirect, so anything else would be an open redirect.
 * Accepts either a full URL (must match the host) or a bare path; returns
 * a safe path+query, "/" when in doubt.
 */
export function safeRd(rd: string | null | undefined, host: string): string {
  if (!rd) return "/";
  if (rd.startsWith("/") && !rd.startsWith("//")) return rd;
  try {
    const u = new URL(rd);
    if (u.hostname.toLowerCase() !== host.toLowerCase()) return "/";
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return "/";
  }
}
