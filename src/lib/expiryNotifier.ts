import { prisma } from "./prisma";
import { auditSystem } from "./audit";
import { getMailSettings, isMailConfigured, sendMail, type MailSettings } from "./mailer";
import { latestPerMac } from "./guestDevices";

/**
 * Expiry notifications: shortly before a guest's access window runs out,
 * send one branded email with a renew link. One email per registration row
 * (expiryNotifiedAt), and only for the newest registration of a MAC — a
 * re-registered device gets a fresh row and a fresh (later) warning.
 * Guests without an email address are skipped.
 */

export type ExpiryNotifyStats = {
  scanned: number;
  sent: number;
  failed: number;
};

function renderExpiryEmail(
  m: MailSettings,
  opts: { firstName: string; deviceLabel: string; expiresAt: Date; leadMin: number; renewUrl: string },
): { subject: string; html: string; text: string } {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const brand = esc(m.brandName);
  const hi = opts.firstName ? `Hi ${esc(opts.firstName)},` : "Hi,";
  const when = opts.expiresAt.toLocaleString("en-GB", { timeZone: "UTC", hour12: false });
  const bodyText =
    `Your WiFi access${opts.deviceLabel ? ` for ${opts.deviceLabel}` : ""} expires at ` +
    `${when} UTC (in about ${opts.leadMin} minutes). Renew it to stay online.`;
  const logo = m.logoUrl && m.portalBaseUrl ? `${m.portalBaseUrl.replace(/\/$/, "")}${m.logoUrl.startsWith("/") ? "" : "/"}${m.logoUrl}` : null;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;padding:32px;">
${logo ? `<tr><td align="center" style="padding-bottom:16px;"><img src="${logo}" alt="${brand}" style="max-height:64px;max-width:220px;"/></td></tr>` : ""}
<tr><td align="center" style="font-size:20px;font-weight:bold;color:#18181b;padding-bottom:8px;">Your WiFi access expires soon</td></tr>
<tr><td style="font-size:14px;color:#3f3f46;line-height:1.6;padding:8px 0 20px;">${hi}<br/><br/>${esc(bodyText)}</td></tr>
${opts.renewUrl ? `<tr><td align="center" style="padding-bottom:24px;">
<a href="${opts.renewUrl}" style="display:inline-block;background:${m.primaryColor || "#171717"};color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 28px;border-radius:6px;">Renew access</a>
</td></tr>
<tr><td style="font-size:12px;color:#a1a1aa;line-height:1.5;">If the button doesn't work, copy this link into your browser:<br/><a href="${opts.renewUrl}" style="color:#71717a;word-break:break-all;">${opts.renewUrl}</a></td></tr>` : `<tr><td style="font-size:12px;color:#a1a1aa;line-height:1.5;">Ask staff to renew your access.</td></tr>`}
<tr><td style="font-size:12px;color:#a1a1aa;padding-top:16px;">${brand}</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const text = `${opts.firstName ? `Hi ${opts.firstName},` : "Hi,"}

${bodyText}

${opts.renewUrl ? `Renew access: ${opts.renewUrl}` : "Ask staff to renew your access."}

${m.brandName}`;

  return { subject: "Your WiFi access expires soon", html, text };
}

export async function runExpiryNotify(): Promise<ExpiryNotifyStats | null> {
  const settings = await prisma.systemSettings.findUnique({ where: { id: "config" } });
  const mail = await getMailSettings();
  if (!settings?.expiryNotifyEnabled || !isMailConfigured(mail)) return null;

  const leadMin = Math.max(5, settings.expiryNotifyLeadMin || 60);
  const now = Date.now();

  // Bounded candidate fetch; the exact expiry window is computed in JS since
  // expiry = authorizedAt + durationMin (per-row) can't be expressed in a
  // simple where-clause.
  const candidates = await prisma.guestRegistration.findMany({
    where: {
      revokedAt: null,
      anonymizedAt: null,
      expiryNotifiedAt: null,
      durationMin: { gt: 0 },
      email: { not: null },
      authorizedAt: { gt: new Date(now - 90 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { authorizedAt: "desc" },
  });

  const inWindow = candidates.filter((r) => {
    const expiry = r.authorizedAt.getTime() + r.durationMin * 60_000;
    return expiry > now && expiry <= now + leadMin * 60_000 && !!r.email;
  });
  if (inWindow.length === 0) return { scanned: candidates.length, sent: 0, failed: 0 };

  // Only warn for the row that actually governs the device's access: a newer
  // registration for the same MAC supersedes the expiring one.
  const macs = [...new Set(inWindow.map((r) => r.macAddress))];
  const newestRows = latestPerMac(
    await prisma.guestRegistration.findMany({
      where: { macAddress: { in: macs }, revokedAt: null },
      orderBy: { authorizedAt: "desc" },
    }),
  );
  const governing = new Set(newestRows.map((r) => r.id));

  const renewBase = (mail.guestBaseUrl || mail.portalBaseUrl || "").replace(/\/+$/, "");
  const renewUrl = renewBase ? `${renewBase}/portal/my-devices` : "";

  let sent = 0;
  let failed = 0;
  for (const r of inWindow) {
    if (!governing.has(r.id)) continue;
    const expiresAt = new Date(r.authorizedAt.getTime() + r.durationMin * 60_000);
    const minutesLeft = Math.max(1, Math.round((expiresAt.getTime() - now) / 60_000));
    try {
      const rendered = renderExpiryEmail(mail, {
        firstName: r.firstName,
        deviceLabel: r.label || "",
        expiresAt,
        leadMin: minutesLeft,
        renewUrl,
      });
      await sendMail(mail, { to: r.email!, ...rendered, kind: "expiry" });
      await prisma.guestRegistration.update({
        where: { id: r.id },
        data: { expiryNotifiedAt: new Date() },
      });
      sent++;
    } catch (err) {
      failed++;
      console.error(`Expiry notification to ${r.email} failed:`, err);
    }
  }
  return { scanned: candidates.length, sent, failed };
}

const FIRST_RUN_DELAY_MS = 90_000;
const INTERVAL_MS = 5 * 60 * 1000;

let started = false;

/** In-process 5-minute expiry-notification timer (single-container deploy). */
export function startExpiryNotifyScheduler(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      const stats = await runExpiryNotify();
      if (stats && (stats.sent > 0 || stats.failed > 0)) {
        await auditSystem({
          actorType: "admin",
          actor: "scheduler",
          action: "expiry.notify",
          detail: stats,
          outcome: stats.failed > 0 ? "failure" : "success",
        });
      }
    } catch (err) {
      console.error("Expiry notification run failed:", err);
    }
  };

  setTimeout(tick, FIRST_RUN_DELAY_MS);
  setInterval(tick, INTERVAL_MS);
  console.log("Expiry-notification scheduler started (every 5 min).");
}
