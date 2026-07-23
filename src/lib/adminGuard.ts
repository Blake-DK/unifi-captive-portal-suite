import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, SETUP_ADMIN_SUB, verifyAdminSession, type AdminSession } from "./auth";
import { audit } from "./audit";
import { prisma } from "./prisma";
import { checkAdminAccess } from "./adminHost";
import { portalMode } from "./portalMode";

/**
 * Auth + permission gate for admin API routes.
 *
 * Levels (least privilege):
 *  - (none)             any signed-in session may read
 *  - write: true        guest-management mutations — "operator" or "admin"
 *  - settings: true     system configuration & account management — "admin" only
 *  - traffic: true      per-guest traffic data — requires the canViewTraffic grant
 *
 * For anything beyond plain reads, the account's CURRENT role/grants are
 * loaded from the DB rather than trusted from the 12h session token, so
 * demoting, deleting, or revoking an account cuts its privileges immediately.
 */
export async function requireAdmin(
  req: NextRequest,
  opts: { write?: boolean; settings?: boolean; traffic?: boolean } = {},
): Promise<{ session: AdminSession; error?: never } | { session?: never; error: NextResponse }> {
  // A guest-role process (PORTAL_MODE=guest) exposes no admin API at all — the
  // whole /api/admin surface 404s regardless of host, cookie, or role.
  if (portalMode() === "guest") {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  // Surface isolation runs BEFORE authentication: on the wrong hostname the
  // admin API doesn't exist (404, even with a valid cookie), and outside the
  // management networks it is closed regardless of credentials.
  const access = await checkAdminAccess(req);
  if (access === "wrong-host") {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  if (access === "ip-not-allowed") {
    audit(req, {
      actorType: "system",
      actor: "admin-guard",
      action: "admin.denied",
      target: `${req.method} ${req.nextUrl.pathname}`,
      detail: { reason: "source address outside the admin allowlist" },
      outcome: "denied",
    });
    return {
      error: NextResponse.json(
        { error: "Forbidden — this network is not on the admin access list" },
        { status: 403 },
      ),
    };
  }

  const session = await verifyAdminSession(req.cookies.get(ADMIN_COOKIE)?.value);
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  // One central audit point for every rejected privilege escalation —
  // forged-role tokens, deleted accounts, monitors poking mutation routes.
  const denied = (reason: string, status = 403) => {
    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: "admin.denied",
      target: `${req.method} ${req.nextUrl.pathname}`,
      detail: { reason },
      outcome: "denied",
    });
    return {
      error:
        status === 403
          ? forbidden(reason)
          : NextResponse.json({ error: reason }, { status }),
    };
  };

  if (session.sub === SETUP_ADMIN_SUB) {
    // First-time setup acts as a full admin, but only until the first admin
    // account exists, and never holds the traffic grant.
    if (opts.traffic) {
      return denied("Traffic data needs a personal account with the grant");
    }
    const admins = await prisma.adminUser.count({ where: { role: "admin" } });
    if (admins > 0) {
      return denied("Setup is finished — sign in with your admin account");
    }
    return { session };
  }

  // Even plain reads confirm the account still exists — a deleted account's
  // token must not keep working until it expires.
  const user = await prisma.adminUser.findUnique({ where: { username: session.sub } });
  if (!user) {
    return denied("Account no longer exists", 401);
  }
  if (user.expiresAt && user.expiresAt <= new Date()) {
    return denied("Account is disabled (its expiry date has passed)", 401);
  }
  // A password change invalidates every session issued before it — otherwise
  // a stolen cookie keeps working for up to 12h after the reset.
  if (user.sessionsValidFrom && session.issuedAt < user.sessionsValidFrom.getTime()) {
    return denied("Session predates a password change — sign in again", 401);
  }
  if (opts.settings && user.role !== "admin") {
    return denied("Settings and account management need the admin role");
  }
  if (opts.write && user.role !== "admin" && user.role !== "operator") {
    return denied("Your account is read-only");
  }
  if (opts.traffic && !user.canViewTraffic) {
    return denied("Your account doesn't have traffic-data access");
  }
  return { session };
}

function forbidden(message: string): NextResponse {
  return NextResponse.json({ error: `Forbidden — ${message}` }, { status: 403 });
}
