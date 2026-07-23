import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMailSettings, isEmailVerificationActive, sendVerificationEmail } from "@/lib/mailer";
import { createEmailVerifyToken, requireGuestPhone } from "@/lib/guestAuth";
import { canonicalizeMac } from "@/lib/mac";
import { rateLimit } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Resend the verification email. Identified either by device MAC (captive
 * portal reminder screen, no session) or by the guest session cookie
 * (my-devices banner).
 */
export async function POST(req: NextRequest) {
  const mail = await getMailSettings();
  if (!isEmailVerificationActive(mail)) {
    return NextResponse.json({ error: "Email verification is not enabled" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const mac = typeof body.mac === "string" ? canonicalizeMac(body.mac) : null;
  const sessionPhone = await requireGuestPhone(req);

  const latest = await prisma.guestRegistration.findFirst({
    where: mac
      ? { macAddress: mac, revokedAt: null, anonymizedAt: null }
      : sessionPhone
        ? { phone: sessionPhone, anonymizedAt: null }
        : { id: -1 },
    orderBy: { authorizedAt: "desc" },
  });
  if (!latest?.email || latest.emailVerifiedAt) {
    return NextResponse.json({ error: "Nothing to confirm for this device" }, { status: 404 });
  }

  const email = latest.email.toLowerCase();
  if (!rateLimit(`verify-resend:${email}`, 3, 10 * 60_000)) {
    return NextResponse.json(
      { error: "Email was sent recently — check your inbox and spam folder" },
      { status: 429 },
    );
  }

  const base = mail.guestBaseUrl || mail.portalBaseUrl || req.nextUrl.origin;
  const token = await createEmailVerifyToken(latest.phone, email);
  sendVerificationEmail(mail, {
    to: email,
    firstName: latest.firstName,
    verifyUrl: `${base.replace(/\/$/, "")}/portal/verify?token=${encodeURIComponent(token)}`,
  });

  audit(req, {
    actorType: "guest",
    actor: latest.phone,
    action: "guest.verify_resend",
    target: email,
  });

  return NextResponse.json({ ok: true });
}
