import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clearUniFiSession } from "@/lib/unifi";
import { invalidateSettingsRow } from "@/lib/settingsRow";
import { clearUpdateCheckCache } from "@/lib/updateCheck";
import { encryptSecret } from "@/lib/secrets";
import { requireAdmin } from "@/lib/adminGuard";
import { portalMode } from "@/lib/portalMode";
import { audit } from "@/lib/audit";
import { ensureTraefikFiles } from "@/lib/traefikStatic";
import { clearAdminAccessCache } from "@/lib/adminHost";
import { ipInCidr } from "@/lib/firewallPlan";
import { clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const settings = await prisma.systemSettings.findUnique({ where: { id: "config" } });
  // Secrets never leave the server — the form's blank field means "keep the
  // current value". `smtpPasswordSet` lets the UI show whether one exists.
  return NextResponse.json({
    ...(settings ?? {}),
    unifiPassword: "",
    unifiPassword2: "",
    unifiPassword2Set: !!settings?.unifiPassword2,
    unifiPassword3: "",
    unifiPassword3Set: !!settings?.unifiPassword3,
    unifiPassword4: "",
    unifiPassword4Set: !!settings?.unifiPassword4,
    unifiApiKey: "",
    unifiApiKeySet: !!settings?.unifiApiKey,
    alarmWebhookSecret: "",
    alarmWebhookSecretSet: !!settings?.alarmWebhookSecret,
    snmpAuthKey: "",
    snmpAuthKeySet: !!settings?.snmpAuthKey,
    snmpPrivKey: "",
    snmpPrivKeySet: !!settings?.snmpPrivKey,
    smtpPassword: "",
    smtpPasswordSet: !!settings?.smtpPassword,
    m365ClientSecret: "",
    m365ClientSecretSet: !!settings?.m365ClientSecret,
    cfDnsApiToken: "",
    cfDnsApiTokenSet: !!settings?.cfDnsApiToken,
    deviceSshPassword: "",
    deviceSshPasswordSet: !!settings?.deviceSshPassword,
    updateCheckToken: "",
    updateCheckTokenSet: !!settings?.updateCheckToken,
    cookieSecure: settings?.cookieSecure ?? false,
    // Derived, never stored: under a guest/admin split this (admin) process
    // serves no guest pages, so relative links into /portal 404 — the portal
    // preview must open on the guest-serving host instead.
    guestPagesRemote: portalMode() === "admin",
  });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const body = await req.json();
  const {
    brandName, logoUrl, backgroundUrl, primaryColor, termsOfUse, privacyNotice, privacyContact, welcomeText,
    unifiUrl, unifiUsername, unifiPassword, unifiSite, unifiInsecureTls, unifiApiType, unifiApiKey,
    unifiUsername2, unifiPassword2, unifiUsername3, unifiPassword3, unifiUsername4, unifiPassword4,
    guestDurationMin, guestDownKbps, guestUpKbps, portalSuccessUrl, portalBaseUrl,
    portalTargetIp, guestBaseUrl, adminBaseUrl, reverseProxyMode, acmeEmail, cfDnsApiToken,
    proxyRootDomains,
    criticalAddresses, pciNetworkIds, adminAllowedCidrs,
    cookieSecure,
    deviceSshUsername, deviceSshPassword, deviceSshPort,
    liveRefreshSec, alertsEnabled, alertPollSec, alertEmail, alertWebhookUrl,
    alertOfflineEnabled, alertCpuPct, alertMemPct, alertFirmwareEnabled, alertSubsystemEnabled,
    alertFailedLoginCount, alertFailedLoginWindowMin, alarmWebhookSecret,
    alertControllerDownEnabled, alertControllerDownCycles,
    snmpEnabled, snmpUser, snmpAuthKey, snmpPrivKey, snmpAuthProtocol, snmpPrivProtocol, snmpPort,
    sponsorRequired, sponsorEmails, sponsorDomains, sponsorDefaultMin, sponsorDurationOverride,
    warningBannerEnabled, warningBannerText,
    reportEnabled, reportFrequency, reportEmail,
    configWatchEnabled,
    syslogEnabled, syslogHost, syslogPort,
    alertSaturationPct, alertPortErrPct, alertRogueExtenderEnabled, alertFirstSeenEnabled,
    dupIpEnabled, dupIpDryRun, dupIpCheckMacRandom, dupIpCheckSessions,
    dupIpCheckDhcp, dupIpCheckArping, dupIpArpingMap,
    updateCheckEnabled, updateCheckToken, updateCheckChannel,
    metricsEnabled, metricSampleSec, metricRetentionDays, metricPerDevice,
    maxDevicesPerPhone, guestQuotaMB,
    defaultRetentionMode, defaultRetentionDays, auditRetentionDays,
    emailVerifyEnabled, emailVerifyInitialMin, emailVerifyGraceMin,
    expiryNotifyEnabled, expiryNotifyLeadMin,
    smtpHost, smtpPort, smtpSecurity, smtpUser, smtpPassword,
    smtpFromEmail, smtpFromName,
    emailProvider, m365TenantId, m365ClientId, m365ClientSecret, m365Sender,
    emailVerifySubject, emailVerifyHeading, emailVerifyBody, emailVerifyButton,
  } = body;

  // Admin-surface allowlist: refuse to SAVE a list that would lock out the
  // very admin saving it — the enforcement side (adminHost.ts) has no safe
  // way to undo a bad list without DB surgery, so the foot-gun is blocked
  // here instead.
  const cidrList =
    typeof adminAllowedCidrs !== "string"
      ? undefined
      : [...new Set(
          adminAllowedCidrs
            .split(/[\s,]+/)
            .map((t: string) => t.trim())
            .filter((t: string) =>
              /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/([0-9]|[12][0-9]|3[0-2]))?$/.test(t) &&
              t.split("/")[0].split(".").every((o: string) => Number(o) <= 255),
            ),
        )];
  if (cidrList && cidrList.length > 0) {
    const ip = clientIp(req);
    const covered = !!ip && cidrList.some((c) => ipInCidr(ip, c.includes("/") ? c : `${c}/32`));
    if (!covered) {
      return NextResponse.json(
        {
          error:
            `Refused: the admin access list (${cidrList.join(", ")}) does not include your own address` +
            `${ip ? ` (${ip})` : " (which could not be determined)"} — saving it would lock you out. ` +
            "Add your management network to the list first.",
        },
        { status: 400 },
      );
    }
  }

  // primaryColor is interpolated verbatim into an inline <style> block in the
  // root layout (dangerouslySetInnerHTML), so an unvalidated value like
  // "red</style><script>…" would be stored XSS. Constrain it to a CSS color
  // token (hex, rgb/hsl(...), or a bare keyword) and fall back to the default.
  const CSS_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9,.%\s/]+\)|[a-zA-Z]{3,20})$/;
  const safeColor =
    typeof primaryColor === "string" && CSS_COLOR_RE.test(primaryColor.trim())
      ? primaryColor.trim()
      : "#171717";

  const updateData: Record<string, unknown> = {
    brandName, logoUrl, backgroundUrl, primaryColor: safeColor, termsOfUse, privacyNotice, privacyContact, welcomeText,
    unifiUrl, unifiUsername, unifiSite,
    // Backup-account usernames; a slot is active only when its password is
    // also stored, so clearing a username disables the slot.
    unifiUsername2: typeof unifiUsername2 === "string" ? unifiUsername2.trim() : "",
    unifiUsername3: typeof unifiUsername3 === "string" ? unifiUsername3.trim() : "",
    unifiUsername4: typeof unifiUsername4 === "string" ? unifiUsername4.trim() : "",
    unifiInsecureTls: Boolean(unifiInsecureTls),
    unifiApiType: unifiApiType ?? "auto",
    portalBaseUrl: portalBaseUrl ?? "",
    portalTargetIp: typeof portalTargetIp === "string" ? portalTargetIp.trim() : "",
    guestBaseUrl: typeof guestBaseUrl === "string" ? guestBaseUrl.trim().replace(/\/+$/, "") : "",
    adminBaseUrl: typeof adminBaseUrl === "string" ? adminBaseUrl.trim().replace(/\/+$/, "") : "",
    reverseProxyMode: ["bundled", "external", "none"].includes(reverseProxyMode) ? reverseProxyMode : "none",
    acmeEmail: typeof acmeEmail === "string" ? acmeEmail.trim() : "",
    // Normalized comma-separated root-domain list; anything that isn't a
    // plausible bare domain is dropped rather than breaking hostname compose.
    // Absent (not just empty) = PRESERVE: a page still running older JS
    // posts a body without this key, and defaulting to "" would silently
    // wipe the saved domains (prisma skips `undefined` fields on update).
    proxyRootDomains:
      typeof proxyRootDomains !== "string"
        ? undefined
        : [...new Set(
            proxyRootDomains
              .toLowerCase()
              .split(/[\s,]+/)
              .map((d) => d.replace(/^\.+|\.+$/g, ""))
              .filter((d) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)),
          )].join(","),
    // Critical addresses: comma-separated IPs/CIDRs, each optionally suffixed
    // with allow tokens ("@all", or "+"-separated port[t|u] / "ping", e.g.
    // "@53+123u+ping") to also allow it through the firewall; junk dropped.
    // Absent (not just empty) = PRESERVE, same stale-tab rationale as
    // proxyRootDomains above.
    criticalAddresses:
      typeof criticalAddresses !== "string"
        ? undefined
        : [...new Set(
            criticalAddresses
              .split(/[\s,]+/)
              .map((t) => t.trim())
              .filter((t) =>
                /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/([0-9]|[12][0-9]|3[0-2]))?(@(all|(ping|\d{1,5}[tu]?)(\+(ping|\d{1,5}[tu]?))*))?$/.test(t) &&
                t.split(/[/@]/)[0].split(".").every((o) => Number(o) <= 255),
              ),
          )].join(", "),
    // Admin-surface allowlist (validated + lockout-checked above); absent =
    // PRESERVE.
    adminAllowedCidrs: cidrList === undefined ? undefined : cidrList.join(", "),
    // PCI-scoped network ids — controller ids are alphanumeric; junk dropped.
    // Absent = PRESERVE (same stale-tab rationale).
    pciNetworkIds:
      typeof pciNetworkIds !== "string"
        ? undefined
        : [...new Set(
            pciNetworkIds
              .split(/[\s,]+/)
              .map((t) => t.trim())
              .filter((t) => /^[a-zA-Z0-9_-]{1,64}$/.test(t)),
          )].join(","),
    cookieSecure: Boolean(cookieSecure),
    deviceSshUsername: typeof deviceSshUsername === "string" ? deviceSshUsername.trim() : "",
    deviceSshPort: Math.min(65535, Math.max(1, Math.round(Number(deviceSshPort) || 22))),
    liveRefreshSec: Math.max(3, Math.min(300, Math.round(Number(liveRefreshSec) || 15))),
    alertsEnabled: Boolean(alertsEnabled),
    alertPollSec: Math.max(30, Math.round(Number(alertPollSec) || 120)),
    alertEmail: typeof alertEmail === "string" ? alertEmail.trim() : "",
    alertWebhookUrl: typeof alertWebhookUrl === "string" ? alertWebhookUrl.trim() : "",
    alertOfflineEnabled: Boolean(alertOfflineEnabled),
    alertCpuPct: Math.max(0, Math.min(100, Math.round(Number(alertCpuPct) || 0))),
    // 0 disables the failed-login rule; the window is clamped to a sane range.
    configWatchEnabled: Boolean(configWatchEnabled),
    syslogEnabled: Boolean(syslogEnabled),
    syslogHost: String(syslogHost ?? "").trim(),
    syslogPort: Math.max(1, Math.min(65535, Math.round(Number(syslogPort) || 514))),
    reportEnabled: Boolean(reportEnabled),
    reportFrequency: ["daily", "weekly", "monthly"].includes(String(reportFrequency)) ? String(reportFrequency) : "weekly",
    reportEmail: String(reportEmail ?? "").trim(),
    warningBannerEnabled: Boolean(warningBannerEnabled),
    warningBannerText: String(warningBannerText ?? ""),
    sponsorRequired: Boolean(sponsorRequired),
    sponsorEmails: String(sponsorEmails ?? ""),
    sponsorDomains: String(sponsorDomains ?? ""),
    sponsorDefaultMin: Math.max(15, Math.min(60 * 24 * 30, Math.round(Number(sponsorDefaultMin) || 1440))),
    sponsorDurationOverride: Boolean(sponsorDurationOverride),
    alertFailedLoginCount: Math.max(0, Math.round(Number(alertFailedLoginCount) || 0)),
    alertFailedLoginWindowMin: Math.max(1, Math.min(1440, Math.round(Number(alertFailedLoginWindowMin) || 15))),
    alertControllerDownEnabled: Boolean(alertControllerDownEnabled),
    alertControllerDownCycles: Math.max(1, Math.min(20, Math.round(Number(alertControllerDownCycles) || 3))),
    snmpEnabled: Boolean(snmpEnabled),
    snmpUser: typeof snmpUser === "string" ? snmpUser.trim() : "",
    snmpAuthProtocol: ["sha", "sha224", "sha256", "sha384", "sha512"].includes(snmpAuthProtocol) ? snmpAuthProtocol : "sha",
    snmpPrivProtocol: ["aes", "aes256b", "aes256r"].includes(snmpPrivProtocol) ? snmpPrivProtocol : "aes",
    snmpPort: Math.min(65535, Math.max(1, Math.round(Number(snmpPort) || 161))),
    alertMemPct: Math.max(0, Math.min(100, Math.round(Number(alertMemPct) || 0))),
    alertFirmwareEnabled: Boolean(alertFirmwareEnabled),
    alertSubsystemEnabled: Boolean(alertSubsystemEnabled),
    alertSaturationPct: Math.max(0, Math.min(100, Math.round(Number(alertSaturationPct) || 0))),
    alertPortErrPct: Math.max(0, Math.min(100, Math.round(Number(alertPortErrPct) || 0))),
    alertRogueExtenderEnabled: Boolean(alertRogueExtenderEnabled),
    alertFirstSeenEnabled: Boolean(alertFirstSeenEnabled),
    dupIpEnabled: Boolean(dupIpEnabled),
    dupIpDryRun: Boolean(dupIpDryRun),
    dupIpCheckMacRandom: Boolean(dupIpCheckMacRandom),
    dupIpCheckSessions: Boolean(dupIpCheckSessions),
    dupIpCheckDhcp: Boolean(dupIpCheckDhcp),
    dupIpCheckArping: Boolean(dupIpCheckArping),
    dupIpArpingMap: typeof dupIpArpingMap === "string" ? dupIpArpingMap.trim() : "",
    updateCheckEnabled: Boolean(updateCheckEnabled),
    updateCheckChannel: ["develop", "nightly"].includes(updateCheckChannel) ? updateCheckChannel : "stable",
    metricsEnabled: Boolean(metricsEnabled),
    metricSampleSec: Math.max(60, Math.round(Number(metricSampleSec) || 300)),
    metricRetentionDays: Math.max(1, Math.round(Number(metricRetentionDays) || 14)),
    metricPerDevice: Boolean(metricPerDevice),
    // 0 is meaningful (unlimited access) — only fall back on absent/garbage
    guestDurationMin: Number.isFinite(Number(guestDurationMin)) && guestDurationMin !== null && guestDurationMin !== ""
      ? Math.max(0, Math.round(Number(guestDurationMin)))
      : 480,
    guestDownKbps: Number(guestDownKbps) || 0,
    guestUpKbps: Number(guestUpKbps) || 0,
    portalSuccessUrl,
    maxDevicesPerPhone: Number(maxDevicesPerPhone) || 5,
    guestQuotaMB: Number(guestQuotaMB) || 0,
    defaultRetentionMode: defaultRetentionMode === "anonymize" ? "anonymize" : "forever",
    defaultRetentionDays: Math.max(0, Math.round(Number(defaultRetentionDays) || 0)),
    auditRetentionDays: Math.max(0, Math.round(Number(auditRetentionDays) || 0)),
    emailVerifyEnabled: Boolean(emailVerifyEnabled),
    expiryNotifyEnabled: Boolean(expiryNotifyEnabled),
    expiryNotifyLeadMin: Math.max(5, Math.round(Number(expiryNotifyLeadMin) || 60)),
    emailVerifyInitialMin: Math.max(5, Math.round(Number(emailVerifyInitialMin) || 60)),
    emailVerifyGraceMin: Math.max(5, Math.round(Number(emailVerifyGraceMin) || 30)),
    smtpHost: typeof smtpHost === "string" ? smtpHost.trim() : "",
    smtpPort: Math.max(1, Math.round(Number(smtpPort) || 587)),
    smtpSecurity: ["none", "starttls", "tls"].includes(smtpSecurity) ? smtpSecurity : "starttls",
    smtpUser: typeof smtpUser === "string" ? smtpUser.trim() : "",
    smtpFromEmail: typeof smtpFromEmail === "string" ? smtpFromEmail.trim() : "",
    smtpFromName: typeof smtpFromName === "string" ? smtpFromName.trim() : "",
    emailProvider: emailProvider === "m365" ? "m365" : "smtp",
    m365TenantId: typeof m365TenantId === "string" ? m365TenantId.trim() : "",
    m365ClientId: typeof m365ClientId === "string" ? m365ClientId.trim() : "",
    m365Sender: typeof m365Sender === "string" ? m365Sender.trim() : "",
    emailVerifySubject: typeof emailVerifySubject === "string" && emailVerifySubject.trim() ? emailVerifySubject : "Confirm your email address",
    emailVerifyHeading: typeof emailVerifyHeading === "string" && emailVerifyHeading.trim() ? emailVerifyHeading : "Confirm your email",
    emailVerifyBody: typeof emailVerifyBody === "string" && emailVerifyBody.trim() ? emailVerifyBody : "Tap the button below to confirm your email address and unlock your full WiFi access.",
    emailVerifyButton: typeof emailVerifyButton === "string" && emailVerifyButton.trim() ? emailVerifyButton : "Confirm email address",
  };

  // Blank = unchanged (the GET never returns the stored values). Secrets are
  // encrypted at rest (see src/lib/secrets.ts).
  if (unifiPassword) updateData.unifiPassword = encryptSecret(unifiPassword);
  if (unifiPassword2) updateData.unifiPassword2 = encryptSecret(unifiPassword2);
  if (unifiPassword3) updateData.unifiPassword3 = encryptSecret(unifiPassword3);
  if (unifiPassword4) updateData.unifiPassword4 = encryptSecret(unifiPassword4);
  if (unifiApiKey) updateData.unifiApiKey = encryptSecret(unifiApiKey);
  if (alarmWebhookSecret) updateData.alarmWebhookSecret = encryptSecret(alarmWebhookSecret);
  if (snmpAuthKey) updateData.snmpAuthKey = encryptSecret(snmpAuthKey);
  if (snmpPrivKey) updateData.snmpPrivKey = encryptSecret(snmpPrivKey);
  if (smtpPassword) updateData.smtpPassword = encryptSecret(smtpPassword);
  if (m365ClientSecret) updateData.m365ClientSecret = encryptSecret(m365ClientSecret);
  if (cfDnsApiToken) updateData.cfDnsApiToken = encryptSecret(cfDnsApiToken);
  if (deviceSshPassword) updateData.deviceSshPassword = encryptSecret(deviceSshPassword);
  if (updateCheckToken) updateData.updateCheckToken = encryptSecret(updateCheckToken);

  const before = await prisma.systemSettings.findUnique({ where: { id: "config" } });
  const settings = await prisma.systemSettings.upsert({
    where: { id: "config" },
    update: updateData,
    create: { id: "config", ...updateData },
  });
  invalidateSettingsRow();

  // Field names only — values here can include credentials.
  const changed = Object.keys(updateData).filter(
    (k) => !before || before[k as keyof typeof before] !== updateData[k],
  );
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "settings.update",
    detail: { changed },
  });

  // Reset cached UniFi session so new credentials take effect immediately
  clearUniFiSession();
  clearUpdateCheckCache();
  clearAdminAccessCache();
  // Re-render the bundled Traefik's static config (traefik.yml + cf-token in
  // the shared mount) so a saved ACME email / Cloudflare token is one
  // `docker compose restart traefik` away from live.
  void ensureTraefikFiles();

  return NextResponse.json(settings);
}
