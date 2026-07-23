import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { SENTINEL_SUBS } from "@/lib/auth";
import { generateTotpSecret, otpauthUri, verifyTotp } from "@/lib/totp";
import { encryptSecret, decryptSecret } from "@/lib/secrets";
import { getSystemSettings } from "@/lib/settings";
import {
  clearRecoveryCodes,
  countUnusedRecoveryCodes,
  regenerateRecoveryCodes,
} from "@/lib/recoveryCodes";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 2FA is per account and self-service: any signed-in account (admin or
 * monitor) manages its own enrollment here. Admins reset someone else's lost
 * 2FA via PATCH /api/admin/accounts/[id] with resetTotp.
 */

/** Status for the signed-in identity. */
export async function GET(req: NextRequest) {
  const { session, error } = await requireAdmin(req);
  if (error) return error;

  if (SENTINEL_SUBS.includes(session.sub)) {
    return NextResponse.json({ account: null, totpEnabled: false });
  }
  const user = await prisma.adminUser.findUnique({
    where: { username: session.sub },
    select: { id: true, username: true, role: true, totpEnabled: true },
  });
  if (!user) return NextResponse.json({ account: null, totpEnabled: false });
  const recoveryCodesRemaining = user.totpEnabled ? await countUnusedRecoveryCodes(user.id) : 0;
  return NextResponse.json({
    account: user.username,
    role: user.role,
    totpEnabled: user.totpEnabled,
    recoveryCodesRemaining,
  });
}

/** Actions: setup (new secret + QR), verify (activate), disable (needs a valid code). */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req);
  if (error) return error;

  if (SENTINEL_SUBS.includes(session.sub)) {
    return NextResponse.json(
      { error: "2FA is per account — sign in with your own admin account" },
      { status: 400 },
    );
  }
  const user = await prisma.adminUser.findUnique({ where: { username: session.sub } });
  if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = body.action;

  if (action === "setup") {
    if (user.totpEnabled) {
      return NextResponse.json({ error: "2FA is already enabled — disable it first" }, { status: 400 });
    }
    const secret = generateTotpSecret();
    await prisma.adminUser.update({
      where: { id: user.id },
      data: { totpSecret: encryptSecret(secret), totpEnabled: false },
    });
    const settings = await getSystemSettings();
    const uri = otpauthUri(settings.brandName || "UniFi Portal", user.username, secret);
    const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
    return NextResponse.json({ ok: true, secret, uri, qrDataUrl });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (action === "verify") {
    if (!user.totpSecret) {
      return NextResponse.json({ error: "Run setup first" }, { status: 400 });
    }
    if (!(await verifyTotp(decryptSecret(user.totpSecret), code))) {
      return NextResponse.json({ error: "Invalid code — check your authenticator app" }, { status: 400 });
    }
    await prisma.adminUser.update({ where: { id: user.id }, data: { totpEnabled: true } });
    // Issue the initial recovery codes and return them once for display.
    const recoveryCodes = await regenerateRecoveryCodes(user.id);
    audit(req, { actorType: "admin", actor: session.sub, action: "account.2fa_enable", target: session.sub });
    return NextResponse.json({ ok: true, recoveryCodes });
  }

  if (action === "regenerate_recovery") {
    if (!user.totpEnabled || !user.totpSecret) {
      return NextResponse.json({ error: "2FA is not enabled" }, { status: 400 });
    }
    if (!(await verifyTotp(decryptSecret(user.totpSecret), code))) {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }
    const recoveryCodes = await regenerateRecoveryCodes(user.id);
    audit(req, { actorType: "admin", actor: session.sub, action: "account.2fa_recovery_regenerate", target: session.sub });
    return NextResponse.json({ ok: true, recoveryCodes });
  }

  if (action === "disable") {
    if (!user.totpEnabled || !user.totpSecret) {
      return NextResponse.json({ error: "2FA is not enabled" }, { status: 400 });
    }
    if (!(await verifyTotp(decryptSecret(user.totpSecret), code))) {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }
    await prisma.adminUser.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecret: null },
    });
    await clearRecoveryCodes(user.id);
    audit(req, { actorType: "admin", actor: session.sub, action: "account.2fa_disable", target: session.sub });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
