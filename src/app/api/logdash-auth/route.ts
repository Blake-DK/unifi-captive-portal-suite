import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ADMIN_COOKIE,
  ADMIN_COOKIE_MAX_AGE,
  SENTINEL_SUBS,
  createSessionToken,
  verifyAdminSession,
  type AdminRole,
} from "@/lib/auth";
import { getCookieSecure } from "@/lib/config";
import { getSettingsRow } from "@/lib/settingsRow";
import { logdashProfileActive, portalMode } from "@/lib/portalMode";
import { HANDOFF_PATH, safeRd, verifyHandoff } from "@/lib/logdashAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Traefik forwardAuth target for the log dashboard: every request to the
 * dashboard host lands here first (traefik forwards the original headers;
 * the original host/path arrive as X-Forwarded-Host/-Uri). Three outcomes:
 *
 *  - valid admin-session cookie (FOR THE DASHBOARD HOST — set by the
 *    handoff below) → 200, traefik forwards to the dashboard.
 *  - the request is the handoff callback (/__portal_auth?token=…, minted by
 *    /api/logdash-auth/start on the admin host) → verify, set the cookie on
 *    the dashboard host, 302 to the originally requested path. ForwardAuth
 *    relays a non-2xx response — including Set-Cookie — to the browser.
 *  - anything else → 302 to the admin host's start endpoint, which owns the
 *    real sign-in (portal account, 2FA, lockouts — all existing machinery).
 *
 * The dashboard is therefore exactly as reachable as the admin panel:
 * portal sign-in, sessionsValidFrom revocation, account expiry all apply on
 * every request. The setup/recovery session is deliberately refused.
 */
export async function GET(req: NextRequest) {
  // The guest-role process never serves auth decisions (mirror of the
  // /api/traefik/config control-plane rule); a disabled profile means no
  // dashboard, so no endpoint either.
  if (portalMode() === "guest" || !logdashProfileActive()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const ldHost = (process.env.LOGDASH_HOST ?? "").trim().toLowerCase();
  const fwdHost = (req.headers.get("x-forwarded-host") ?? "").trim().toLowerCase();
  if (!ldHost || fwdHost !== ldHost) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const uri = req.headers.get("x-forwarded-uri") ?? "/";

  // Handoff callback: mint the dashboard-host cookie and bounce to the
  // originally requested path.
  if (uri.startsWith(`${HANDOFF_PATH}?`) || uri === HANDOFF_PATH) {
    const token = new URLSearchParams(uri.split("?")[1] ?? "").get("token") ?? "";
    const claims = verifyHandoff(process.env.ADMIN_SECRET ?? "", token, ldHost);
    if (claims && (await accountStillValid(claims.sub, Date.now()))) {
      const role: AdminRole =
        claims.role === "operator" || claims.role === "monitor" ? claims.role : "admin";
      const res = NextResponse.redirect(
        `https://${ldHost}${pastLanding(safeRd(claims.rd, ldHost))}`,
        302,
      );
      res.cookies.set(ADMIN_COOKIE, await createSessionToken(claims.sub, role), {
        httpOnly: true,
        secure: await getCookieSecure(),
        sameSite: "lax",
        maxAge: ADMIN_COOKIE_MAX_AGE,
        path: "/",
      });
      return res;
    }
    // Expired/invalid handoff: restart the flow rather than dead-ending.
    return redirectToStart(ldHost, "/");
  }

  const session = await verifyAdminSession(req.cookies.get(ADMIN_COOKIE)?.value);
  if (session && !SENTINEL_SUBS.includes(session.sub) && (await accountStillValid(session.sub, session.issuedAt))) {
    // The app's root is a landing/brochure page; the analytics live at
    // /dashboard — signed-in visitors skip straight past it.
    if (uri === "/" || uri === "") {
      return NextResponse.redirect(`https://${ldHost}/dashboard`, 302);
    }
    return new NextResponse(null, { status: 200 });
  }
  return redirectToStart(ldHost, uri);
}

/** "/" lands on the app's brochure page — send handoff arrivals to the data. */
function pastLanding(path: string): string {
  return path === "/" ? "/dashboard" : path;
}

/** Mirror requireAdmin's liveness rules: account exists, not expired, and
 * the session was issued after any password change. */
async function accountStillValid(sub: string, issuedAt: number): Promise<boolean> {
  try {
    const user = await prisma.adminUser.findUnique({
      where: { username: sub },
      select: { expiresAt: true, sessionsValidFrom: true },
    });
    if (!user) return false;
    if (user.expiresAt && user.expiresAt <= new Date()) return false;
    if (user.sessionsValidFrom && issuedAt < user.sessionsValidFrom.getTime()) return false;
    return true;
  } catch {
    return false;
  }
}

async function redirectToStart(ldHost: string, uri: string): Promise<NextResponse> {
  const s = await getSettingsRow().catch(() => null);
  const adminBase = (s?.adminBaseUrl ?? "").trim().replace(/\/+$/, "");
  if (!adminBase) {
    return NextResponse.json(
      { error: "Sign-in unavailable: set the Admin URL in Settings → URLs — the dashboard signs in through the admin host" },
      { status: 401 },
    );
  }
  const rd = encodeURIComponent(`https://${ldHost}${uri}`);
  return NextResponse.redirect(`${adminBase}/api/logdash-auth/start?rd=${rd}`, 302);
}
