import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";
import { audit } from "./audit";
import { SETUP_ADMIN_SUB, checkSetupPassword, type AdminSession } from "./auth";
import { verifyPassword } from "./passwords";
import { verifyTotp } from "./totp";
import { decryptSecret } from "./secrets";
import { rateLimit, clientIp } from "./rateLimit";

/**
 * Fresh-credentials re-auth for destructive admin actions (container
 * restart, future dangerous applies): the session cookie alone is not
 * enough — the caller must supply the account password again, plus the
 * one-time code when TOTP is enrolled. Extracted from the old Pangolin
 * admin-resource apply flow. Returns null when re-auth passes, otherwise
 * the 401/429 response to send (with `needCode: true` when the UI should
 * ask for the TOTP code and retry).
 */
export async function verifyReauth(
  req: NextRequest,
  session: AdminSession,
  password: string,
  code: string,
  auditAction: string,
): Promise<NextResponse | null> {
  const fail = (error: string, stage: string, needCode = false) => {
    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: auditAction,
      detail: { stage },
      outcome: "failure",
    });
    return NextResponse.json({ error, needCode }, { status: 401 });
  };

  if (!rateLimit(`reauth:${auditAction}:${clientIp(req) ?? "unknown"}`, 10, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  if (session.sub === SETUP_ADMIN_SUB) {
    if (!password || !(await checkSetupPassword(password))) {
      return fail("Invalid password", "reauth-password");
    }
    return null;
  }

  const user = await prisma.adminUser.findUnique({ where: { username: session.sub } });
  if (!user) return fail("Account no longer exists", "reauth-account");
  if (!password || !(await verifyPassword(password, user.passwordHash))) {
    return fail("Invalid password", "reauth-password");
  }
  if (user.totpEnabled && user.totpSecret) {
    if (!code) {
      // Not a failed attempt — the UI asks for the code and retries.
      return NextResponse.json({ error: "2FA code required", needCode: true }, { status: 401 });
    }
    if (!(await verifyTotp(decryptSecret(user.totpSecret), code))) {
      return fail("Invalid 2FA code", "reauth-2fa", true);
    }
  }
  return null;
}
