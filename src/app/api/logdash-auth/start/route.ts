import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ADMIN_COOKIE, SENTINEL_SUBS, verifyAdminSession } from "@/lib/auth";
import { checkAdminAccess } from "@/lib/adminHost";
import { logdashProfileActive, portalMode } from "@/lib/portalMode";
import { HANDOFF_PATH, mintHandoff, safeRd } from "@/lib/logdashAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs on the ADMIN host, where the real admin-session cookie lives: mints
 * the 60s handoff that lets the log dashboard's hostname set its own
 * session cookie (see /api/logdash-auth). Signed-out browsers detour
 * through the normal /admin/login (2FA and lockouts included) and come
 * back here via its ?next= parameter.
 */
export async function GET(req: NextRequest) {
  if (portalMode() === "guest" || !logdashProfileActive()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Same surface rules as every admin route: wrong hostname = doesn't exist,
  // off-allowlist networks = closed.
  const access = await checkAdminAccess(req);
  if (access === "wrong-host") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (access === "ip-not-allowed") {
    return NextResponse.json({ error: "This network is not on the admin access list" }, { status: 403 });
  }
  const ldHost = (process.env.LOGDASH_HOST ?? "").trim().toLowerCase();
  if (!ldHost) return NextResponse.json({ error: "not found" }, { status: 404 });

  const rdRaw = req.nextUrl.searchParams.get("rd");
  const rd = safeRd(rdRaw, ldHost);

  const session = await verifyAdminSession(req.cookies.get(ADMIN_COOKIE)?.value);
  // The setup/recovery session is pinned to account creation — no dashboard.
  if (!session || SENTINEL_SUBS.includes(session.sub)) {
    const self = `/api/logdash-auth/start?rd=${encodeURIComponent(rdRaw ?? "/")}`;
    return NextResponse.redirect(
      new URL(`/admin/login?next=${encodeURIComponent(self)}`, req.nextUrl.origin),
      302,
    );
  }
  // Deleted/expired accounts and pre-password-change sessions don't hand off.
  const user = await prisma.adminUser
    .findUnique({ where: { username: session.sub }, select: { expiresAt: true, sessionsValidFrom: true } })
    .catch(() => null);
  const valid =
    !!user &&
    (!user.expiresAt || user.expiresAt > new Date()) &&
    (!user.sessionsValidFrom || session.issuedAt >= user.sessionsValidFrom.getTime());
  if (!valid) {
    const self = `/api/logdash-auth/start?rd=${encodeURIComponent(rdRaw ?? "/")}`;
    return NextResponse.redirect(
      new URL(`/admin/login?next=${encodeURIComponent(self)}`, req.nextUrl.origin),
      302,
    );
  }

  const token = mintHandoff(process.env.ADMIN_SECRET ?? "", ldHost, {
    sub: session.sub,
    role: session.role,
    rd,
  });
  return NextResponse.redirect(
    `https://${ldHost}${HANDOFF_PATH}?token=${encodeURIComponent(token)}`,
    302,
  );
}
