import nodemailer from "nodemailer";
import { prisma } from "./prisma";
import { getSettingsRow } from "./settingsRow";
import { decryptSecret } from "./secrets";
import { sendViaM365 } from "./m365Mail";

export type MailSettings = {
  emailVerifyEnabled: boolean;
  emailVerifyInitialMin: number;
  emailVerifyGraceMin: number;
  /** "smtp" (nodemailer) | "m365" (Graph sendMail — docs/M365-EMAIL.md). */
  emailProvider: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string; // "none" | "starttls" | "tls"
  smtpUser: string;
  smtpPassword: string;
  smtpFromEmail: string;
  smtpFromName: string;
  m365TenantId: string;
  m365ClientId: string;
  m365ClientSecret: string;
  m365Sender: string;
  emailVerifySubject: string;
  emailVerifyHeading: string;
  emailVerifyBody: string;
  emailVerifyButton: string;
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  portalBaseUrl: string;
  guestBaseUrl: string; // self-service host — where verification links should point
};

export async function getMailSettings(): Promise<MailSettings | null> {
  const s = await getSettingsRow();
  if (!s) return null;
  return {
    emailVerifyEnabled: s.emailVerifyEnabled,
    emailVerifyInitialMin: s.emailVerifyInitialMin,
    emailVerifyGraceMin: s.emailVerifyGraceMin,
    smtpHost: s.smtpHost,
    smtpPort: s.smtpPort,
    smtpSecurity: s.smtpSecurity,
    smtpUser: s.smtpUser,
    smtpPassword: decryptSecret(s.smtpPassword),
    smtpFromEmail: s.smtpFromEmail,
    smtpFromName: s.smtpFromName,
    emailProvider: s.emailProvider,
    m365TenantId: s.m365TenantId,
    m365ClientId: s.m365ClientId,
    // Decrypt failure fails closed to "" → the provider reads as unconfigured
    // and every mail gate deactivates instead of throwing mid-send.
    m365ClientSecret: decryptSecret(s.m365ClientSecret),
    m365Sender: s.m365Sender,
    emailVerifySubject: s.emailVerifySubject,
    emailVerifyHeading: s.emailVerifyHeading,
    emailVerifyBody: s.emailVerifyBody,
    emailVerifyButton: s.emailVerifyButton,
    brandName: s.brandName,
    logoUrl: s.logoUrl,
    primaryColor: s.primaryColor,
    portalBaseUrl: s.portalBaseUrl || "",
    guestBaseUrl: s.guestBaseUrl || "",
  };
}

/** True when the ACTIVE provider has everything it needs to send. */
export function isMailConfigured(m: MailSettings | null): m is MailSettings {
  if (!m) return false;
  if (m.emailProvider === "m365") {
    return !!(m.m365TenantId && m.m365ClientId && m.m365ClientSecret && m.m365Sender);
  }
  return !!(m.smtpHost && m.smtpFromEmail);
}

/** Verification is only enforced when the toggle is on AND mail can actually send. */
export function isEmailVerificationActive(m: MailSettings | null): m is MailSettings {
  return !!m && m.emailVerifyEnabled && isMailConfigured(m);
}

function buildTransport(m: MailSettings) {
  return nodemailer.createTransport({
    host: m.smtpHost,
    port: m.smtpPort,
    secure: m.smtpSecurity === "tls", // implicit TLS; "starttls"/"none" negotiate on plain
    ignoreTLS: m.smtpSecurity === "none",
    requireTLS: m.smtpSecurity === "starttls",
    auth: m.smtpUser ? { user: m.smtpUser, pass: m.smtpPassword } : undefined,
  });
}

function absoluteUrl(base: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${base.replace(/\/$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Branded verification email. Design (heading/body/button/subject) comes from
 * Settings -> Email; logo and colours come from Settings -> Branding.
 */
export function renderVerifyEmail(
  m: MailSettings,
  opts: { firstName: string; verifyUrl: string },
): { subject: string; html: string; text: string } {
  const logo =
    m.logoUrl && m.portalBaseUrl ? absoluteUrl(m.portalBaseUrl, m.logoUrl) : null;
  const heading = escapeHtml(m.emailVerifyHeading);
  const body = escapeHtml(m.emailVerifyBody).replace(/\n/g, "<br/>");
  const button = escapeHtml(m.emailVerifyButton);
  const brand = escapeHtml(m.brandName);
  const hi = opts.firstName ? `Hi ${escapeHtml(opts.firstName)},` : "Hi,";

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;padding:32px;">
${logo ? `<tr><td align="center" style="padding-bottom:16px;"><img src="${logo}" alt="${brand}" style="max-height:64px;max-width:220px;"/></td></tr>` : ""}
<tr><td align="center" style="font-size:20px;font-weight:bold;color:#18181b;padding-bottom:8px;">${heading}</td></tr>
<tr><td style="font-size:14px;color:#3f3f46;line-height:1.6;padding:8px 0 20px;">${hi}<br/><br/>${body}</td></tr>
<tr><td align="center" style="padding-bottom:24px;">
<a href="${opts.verifyUrl}" style="display:inline-block;background:${m.primaryColor || "#171717"};color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 28px;border-radius:6px;">${button}</a>
</td></tr>
<tr><td style="font-size:12px;color:#a1a1aa;line-height:1.5;">If the button doesn't work, copy this link into your browser:<br/><a href="${opts.verifyUrl}" style="color:#71717a;word-break:break-all;">${opts.verifyUrl}</a></td></tr>
<tr><td style="font-size:12px;color:#a1a1aa;padding-top:16px;">${brand}</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const text = `${opts.firstName ? `Hi ${opts.firstName},` : "Hi,"}

${m.emailVerifyBody}

${m.emailVerifyButton}: ${opts.verifyUrl}

${m.brandName}`;

  return { subject: m.emailVerifySubject, html, text };
}

export type MailKind = "verify" | "expiry" | "alert" | "test" | "sponsor" | "report";

/**
 * The single send path for every provider — and the EmailLog hook: one row
 * per attempt (success or failure) feeds the Send-activity card. Logging is
 * best-effort (a failed write never changes the send's outcome) but awaited,
 * so the row is committed by the time the caller returns — the test-send
 * route refreshes the activity card immediately after.
 */
export async function sendMail(
  m: MailSettings,
  opts: { to: string; subject: string; html: string; text: string; kind?: MailKind },
): Promise<void> {
  const provider = m.emailProvider === "m365" ? "m365" : "smtp";
  const log = (ok: boolean, error?: string) =>
    prisma.emailLog
      .create({
        data: {
          kind: opts.kind ?? "verify",
          to: opts.to,
          subject: opts.subject,
          provider,
          ok,
          error: error ? error.slice(0, 500) : null,
        },
      })
      .catch((e) => console.error("EmailLog write failed:", e));

  try {
    if (provider === "m365") {
      await sendViaM365(
        {
          tenantId: m.m365TenantId,
          clientId: m.m365ClientId,
          clientSecret: m.m365ClientSecret,
          sender: m.m365Sender,
        },
        { to: opts.to, subject: opts.subject, html: opts.html },
      );
    } else {
      const transport = buildTransport(m);
      await transport.sendMail({
        from: m.smtpFromName ? `"${m.smtpFromName}" <${m.smtpFromEmail}>` : m.smtpFromEmail,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
    }
  } catch (err) {
    await log(false, err instanceof Error ? err.message : String(err));
    throw err;
  }
  await log(true);
}

/**
 * Fire-and-forget wrapper for the registration path: a mail failure must not
 * fail the registration (the guest already has their provisional window and
 * the portal offers a resend). Failures land in the container log.
 */
export function sendVerificationEmail(
  m: MailSettings,
  opts: { to: string; firstName: string; verifyUrl: string },
): void {
  const rendered = renderVerifyEmail(m, { firstName: opts.firstName, verifyUrl: opts.verifyUrl });
  sendMail(m, { to: opts.to, ...rendered, kind: "verify" }).catch((err) => {
    console.error(`Verification email to ${opts.to} failed:`, err);
  });
}
