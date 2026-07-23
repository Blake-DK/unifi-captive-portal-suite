import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { getMailSettings, isMailConfigured, renderVerifyEmail, sendMail } from "@/lib/mailer";

export const runtime = "nodejs";

/** Sends the real verification template to an admin-chosen address using the SAVED settings. */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!to || !to.includes("@")) {
    return NextResponse.json({ error: "A destination email address is required" }, { status: 400 });
  }

  const mail = await getMailSettings();
  if (!isMailConfigured(mail)) {
    return NextResponse.json(
      {
        error:
          "Save the email provider settings first (SMTP host + from-address, or the Microsoft 365 tenant/client/secret/sender).",
      },
      { status: 400 },
    );
  }

  const base = mail.guestBaseUrl || mail.portalBaseUrl || req.nextUrl.origin;
  const rendered = renderVerifyEmail(mail, {
    firstName: "Test",
    verifyUrl: `${base.replace(/\/$/, "")}/portal/verify?token=test-link-preview`,
  });

  try {
    await sendMail(mail, { to, subject: `[Test] ${rendered.subject}`, html: rendered.html, text: rendered.text, kind: "test" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Send failed: ${message}` }, { status: 502 });
  }

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "settings.email_test",
    target: to,
  });

  return NextResponse.json({ ok: true });
}
