import { Suspense } from "react";
import { PortalForm, type SponsorConfig } from "@/components/portal/PortalForm";
import { WarningBannerGate } from "@/components/portal/WarningBannerGate";
import { parseSponsorList } from "@/lib/sponsor";
import { VerifyReminder } from "@/components/portal/VerifyReminder";
import { getSystemSettings } from "@/lib/settings";
import { listLocationsForPortal } from "@/lib/locations";
import { getMailSettings, isEmailVerificationActive } from "@/lib/mailer";
import { canonicalizeMac } from "@/lib/mac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  const visible = user.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const preview = sp.preview === "1";
  const [settings, locations, mail] = await Promise.all([
    getSystemSettings(),
    listLocationsForPortal(),
    getMailSettings(),
  ]);
  const verifyActive = isEmailVerificationActive(mail);

  // Sponsored access: the form swaps direct authorization for a
  // sponsor-approval request (a voucher still bypasses it).
  const sponsorRow = await prisma.systemSettings.findUnique({
    where: { id: "config" },
    select: {
      sponsorRequired: true,
      sponsorEmails: true,
      sponsorDomains: true,
      sponsorDefaultMin: true,
      warningBannerEnabled: true,
      warningBannerText: true,
    },
  });
  const banner =
    sponsorRow?.warningBannerEnabled && sponsorRow.warningBannerText.trim()
      ? sponsorRow.warningBannerText
      : null;
  const sponsor: SponsorConfig | null = sponsorRow?.sponsorRequired
    ? {
        emails: parseSponsorList(sponsorRow.sponsorEmails),
        domains: parseSponsorList(sponsorRow.sponsorDomains),
        defaultMin: sponsorRow.sponsorDefaultMin,
      }
    : null;

  // A returning guest who never confirmed their email gets a short-cut
  // "check your inbox" screen with a grace window instead of the full form.
  let reminder: { mac: string; maskedEmail: string; graceMin: number } | null = null;
  const rawMac = (typeof sp.id === "string" && sp.id) || (typeof sp.mac === "string" && sp.mac) || "";
  const wantsForm = sp.register === "1";
  if (verifyActive && rawMac && !wantsForm && !preview) {
    const mac = canonicalizeMac(rawMac);
    if (mac) {
      const latest = await prisma.guestRegistration.findFirst({
        where: { macAddress: mac, anonymizedAt: null, revokedAt: null },
        orderBy: { authorizedAt: "desc" },
        select: { email: true, emailVerifiedAt: true },
      });
      if (latest?.email && !latest.emailVerifiedAt) {
        reminder = {
          mac: rawMac,
          maskedEmail: maskEmail(latest.email),
          graceMin: mail.emailVerifyGraceMin,
        };
      }
    }
  }

  const bgStyle = settings.backgroundUrl
    ? { backgroundImage: `url(${settings.backgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {};

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-muted/40 p-4"
      style={bgStyle}
    >
      <div className={settings.backgroundUrl ? "absolute inset-0 bg-black/30 backdrop-blur-sm" : ""} />
      <div className="relative z-10 w-full max-w-md">
        <Suspense fallback={<div>Loading...</div>}>
          {banner && !preview ? (
            <WarningBannerGate text={banner}>
              {reminder ? (
                <VerifyReminder settings={settings} {...reminder} />
              ) : (
                <PortalForm
                  settings={settings}
                  locations={locations}
                  emailRequired={verifyActive}
                  preview={preview}
                  sponsor={sponsor}
                />
              )}
            </WarningBannerGate>
          ) : reminder ? (
            <VerifyReminder settings={settings} {...reminder} />
          ) : (
            <PortalForm
              settings={settings}
              locations={locations}
              emailRequired={verifyActive}
              preview={preview}
              sponsor={sponsor}
            />
          )}
        </Suspense>
      </div>
    </main>
  );
}
