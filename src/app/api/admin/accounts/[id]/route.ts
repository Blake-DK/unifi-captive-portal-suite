import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import {
  ADMIN_COOKIE,
  ADMIN_COOKIE_MAX_AGE,
  SETUP_ADMIN_SUB,
  checkSetupPassword,
  createSessionToken,
  type AdminRole,
} from "@/lib/auth";
import { getCookieSecure } from "@/lib/config";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

async function loadTarget(idRaw: string) {
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id)) return null;
  return prisma.adminUser.findUnique({ where: { id } });
}

/**
 * True if `target` is the only full-admin account. Demoting or deleting it
 * would reopen the shared-password recovery login — guard against doing that
 * by accident.
 */
async function isLastAdmin(target: { id: number; role: string }): Promise<boolean> {
  if (target.role !== "admin") return false;
  const admins = await prisma.adminUser.count({ where: { role: "admin" } });
  return admins <= 1;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const target = await loadTarget((await params).id);
  if (!target) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // Separation of duties: an admin cannot grant themselves privileges. Changing
  // your own role or your own traffic-data access has to go through another
  // admin, so no single account can silently escalate itself (both are still
  // audited, but audit is after-the-fact — this prevents it).
  const isSelf = target.username === session.sub;
  if (isSelf && typeof body.role === "string" && body.role !== target.role) {
    return NextResponse.json(
      { error: "You can't change your own role — ask another admin." },
      { status: 403 },
    );
  }
  if (
    isSelf &&
    typeof body.canViewTraffic === "boolean" &&
    body.canViewTraffic !== target.canViewTraffic
  ) {
    return NextResponse.json(
      { error: "You can't change your own traffic-data access — ask another admin." },
      { status: 403 },
    );
  }

  // Like role/grants: your own expiry only moves via another admin, so a
  // temp admin can't simply extend themselves.
  if (isSelf && body.expiresAt !== undefined) {
    return NextResponse.json(
      { error: "You can't change your own expiry date — ask another admin." },
      { status: 403 },
    );
  }

  const data: {
    passwordHash?: string;
    role?: string;
    canViewTraffic?: boolean;
    totpSecret?: null;
    totpEnabled?: boolean;
    expiresAt?: Date | null;
    sessionsValidFrom?: Date;
  } = {};

  if (typeof body.password === "string" && body.password) {
    if (body.password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    data.passwordHash = await hashPassword(body.password);
    // Revoke every session issued before the reset — a password change must
    // also cut off whoever else may hold the old cookie.
    data.sessionsValidFrom = new Date();
  }
  if (["admin", "operator", "monitor"].includes(body.role)) {
    if (body.role !== "admin" && (await isLastAdmin(target))) {
      return NextResponse.json({ error: "Cannot demote the last admin account" }, { status: 400 });
    }
    data.role = body.role;
  }
  if (typeof body.canViewTraffic === "boolean") {
    data.canViewTraffic = body.canViewTraffic;
  }
  if (body.resetTotp === true) {
    data.totpSecret = null;
    data.totpEnabled = false;
  }
  if (body.expiresAt !== undefined) {
    if (body.expiresAt === null || body.expiresAt === "") {
      data.expiresAt = null;
    } else {
      const d = new Date(body.expiresAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid expiry date" }, { status: 400 });
      }
      if (await isLastAdmin(target)) {
        return NextResponse.json(
          { error: "Cannot put an expiry date on the last admin account" },
          { status: 400 },
        );
      }
      data.expiresAt = d;
    }
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  await prisma.adminUser.update({ where: { id: target.id }, data });
  // Resetting 2FA also invalidates any outstanding recovery codes.
  if (body.resetTotp === true) {
    await prisma.totpRecoveryCode.deleteMany({ where: { userId: target.id } });
  }
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "account.update",
    target: target.username,
    detail: {
      ...(data.passwordHash ? { passwordChanged: true } : {}),
      ...(data.role !== undefined ? { role: data.role } : {}),
      ...(data.canViewTraffic !== undefined ? { canViewTraffic: data.canViewTraffic } : {}),
      ...(body.resetTotp === true ? { resetTotp: true } : {}),
      ...(data.expiresAt !== undefined
        ? { expiresAt: data.expiresAt ? data.expiresAt.toISOString() : null }
        : {}),
    },
  });
  // A self password change would instantly invalidate the very session that
  // made it (sessionsValidFrom > this cookie's issuedAt) — reissue the cookie
  // so the acting admin stays signed in while everyone else is cut off.
  const res = NextResponse.json({ ok: true });
  if (isSelf && data.passwordHash) {
    res.cookies.set(ADMIN_COOKIE, await createSessionToken(session.sub, target.role as AdminRole), {
      httpOnly: true,
      sameSite: "lax",
      secure: await getCookieSecure(),
      path: "/",
      maxAge: ADMIN_COOKIE_MAX_AGE,
    });
  }
  return res;
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const target = await loadTarget((await params).id);
  if (!target) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  if (target.username === session.sub) {
    return NextResponse.json(
      { error: "You can't delete your own account — ask another admin." },
      { status: 403 },
    );
  }
  if (await isLastAdmin(target)) {
    return NextResponse.json({ error: "Cannot delete the last admin account" }, { status: 400 });
  }

  // Deletion is the one destructive, irreversible account action: it takes a
  // written reason (kept in the audit trail) and a fresh proof of identity —
  // the acting admin's own password — so a hijacked session can't quietly
  // remove accounts.
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (reason.length < 3) {
    return NextResponse.json(
      { error: "A reason for the deletion is required" },
      { status: 400 },
    );
  }
  const actor =
    session.sub === SETUP_ADMIN_SUB
      ? null
      : await prisma.adminUser.findUnique({ where: { username: session.sub } });
  const passwordOk = actor
    ? await verifyPassword(password, actor.passwordHash)
    : await checkSetupPassword(password);
  if (!passwordOk) {
    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: "account.delete",
      target: target.username,
      detail: { reason, stage: "password-confirm" },
      outcome: "failure",
    });
    return NextResponse.json({ error: "Password confirmation failed" }, { status: 403 });
  }

  await prisma.adminUser.delete({ where: { id: target.id } });
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "account.delete",
    target: target.username,
    detail: { role: target.role, reason },
  });
  return NextResponse.json({ ok: true });
}
