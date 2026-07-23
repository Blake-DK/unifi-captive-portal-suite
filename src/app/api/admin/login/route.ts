import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ADMIN_COOKIE,
  ADMIN_COOKIE_MAX_AGE,
  SETUP_ADMIN_SUB,
  checkSetupPassword,
  createSessionToken,
  type AdminRole,
} from "@/lib/auth";
import { verifyPassword } from "@/lib/passwords";
import { verifyTotp } from "@/lib/totp";
import { consumeRecoveryCode } from "@/lib/recoveryCodes";
import { decryptSecret } from "@/lib/secrets";
import { clientIp, isOverLimit, rateLimit, recordAttempt } from "@/lib/rateLimit";
import { checkAdminAccess } from "@/lib/adminHost";
import { audit } from "@/lib/audit";
import { getCookieSecure } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Surface isolation (requireAdmin does this for every other admin route,
  // but login has no session yet): wrong hostname = the login doesn't exist;
  // outside the management networks = closed.
  const access = await checkAdminAccess(req);
  if (access === "wrong-host") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (access === "ip-not-allowed") {
    return NextResponse.json(
      { error: "This network is not on the admin access list" },
      { status: 403 },
    );
  }

  // 20, not 10: a 2FA login legitimately hits this route twice (password
  // step, then password+code), and several admins can share one NAT'd IP.
  if (!rateLimit(`admin-login:${clientIp(req) ?? "unknown"}`, 20, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";

  // Per-username failure lockout beside the per-IP window above: the IP limit
  // alone lets one account be sprayed from many addresses. Only FAILED
  // attempts count (see recordAttempt calls below), so a 2FA login's two
  // legitimate hops never burn the budget.
  const userKey = `admin-login-user:${username}`;
  if (username && isOverLimit(userKey, USER_FAIL_LIMIT)) {
    audit(req, {
      actorType: "admin",
      actor: username,
      action: "admin.login",
      detail: { stage: "user-lockout" },
      outcome: "failure",
    });
    return NextResponse.json(
      { error: "Too many failed attempts for this account. Try again later." },
      { status: 429 },
    );
  }

  let sub: string;
  let role: AdminRole;

  if (!username) {
    // Blank username + the ADMIN_PASSWORD env var works ONLY while no
    // admin-role account exists: a first-time-setup session pinned to the
    // account-creation page by the proxy. Keyed to the *admin* count so a
    // monitor-only state stays recoverable. There is no shared login once an
    // admin account exists.
    const adminCount = await prisma.adminUser.count({ where: { role: "admin" } });
    if (adminCount > 0 || !(await checkSetupPassword(password))) {
      audit(req, {
        actorType: "admin",
        actor: SETUP_ADMIN_SUB,
        action: "admin.login",
        detail: { stage: "setup-password" },
        outcome: "failure",
      });
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }
    sub = SETUP_ADMIN_SUB;
    role = "admin";
  } else {
    const user = await prisma.adminUser.findUnique({ where: { username } });
    // Verify against a constant dummy hash when the user doesn't exist, so
    // response timing doesn't reveal which usernames are taken.
    const ok = user
      ? await verifyPassword(password, user.passwordHash)
      : await verifyPassword(password, DUMMY_HASH).then(() => false);
    if (!user || !ok) {
      recordAttempt(userKey, USER_FAIL_WINDOW_MS);
      audit(req, {
        actorType: "admin",
        actor: username,
        action: "admin.login",
        detail: { stage: "password" },
        outcome: "failure",
      });
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    // Temp-admin auto-disable: only revealed after the password verified, so
    // the message doesn't leak account state to guessers.
    if (user.expiresAt && user.expiresAt <= new Date()) {
      audit(req, {
        actorType: "admin",
        actor: username,
        action: "admin.login",
        detail: { stage: "expired" },
        outcome: "failure",
      });
      return NextResponse.json(
        { error: "This account is disabled — its expiry date has passed." },
        { status: 401 },
      );
    }

    if (user.totpEnabled && user.totpSecret) {
      if (!code) {
        // Not a failed attempt — the normal first hop of a 2FA login.
        return NextResponse.json({ error: "2FA code required", needCode: true }, { status: 401 });
      }
      // Accept the TOTP code, or fall back to a one-time recovery code (which
      // contains letters, so verifyTotp rejects it first) when the
      // authenticator is unavailable.
      const totpOk = await verifyTotp(decryptSecret(user.totpSecret), code);
      const recoveryOk = totpOk ? false : await consumeRecoveryCode(user.id, code);
      if (!totpOk && !recoveryOk) {
        recordAttempt(userKey, USER_FAIL_WINDOW_MS);
        audit(req, {
          actorType: "admin",
          actor: username,
          action: "admin.login",
          detail: { stage: "2fa" },
          outcome: "failure",
        });
        return NextResponse.json({ error: "Invalid 2FA code", needCode: true }, { status: 401 });
      }
      if (recoveryOk) {
        // Note the recovery-code login so it's visible in the audit trail.
        audit(req, {
          actorType: "admin",
          actor: username,
          action: "admin.login",
          detail: { stage: "recovery-code" },
        });
      }
    }

    sub = user.username;
    role = user.role === "admin" || user.role === "operator" ? user.role : "monitor";
    prisma.adminUser
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      .catch(() => {});
  }

  audit(req, { actorType: "admin", actor: sub, action: "admin.login" });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, await createSessionToken(sub, role), {
    httpOnly: true,
    sameSite: "lax",
    secure: await getCookieSecure(),
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });
  return res;
}

// 5 failures per username per window — deliberately tighter than the per-IP
// limit; a legitimate admin who typo'd five times waits 15 minutes (or another
// admin resets the password, which also revokes old sessions).
const USER_FAIL_LIMIT = 5;
const USER_FAIL_WINDOW_MS = 15 * 60 * 1000;

// Any well-formed scrypt hash works; it never matches a real password.
const DUMMY_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
