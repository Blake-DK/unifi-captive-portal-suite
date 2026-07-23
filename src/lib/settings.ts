import { prisma } from "./prisma";
import { getSettingsRow, primeSettingsRow } from "./settingsRow";

export interface SystemSettings {
  brandName: string;
  logoUrl: string | null;
  backgroundUrl: string | null;
  primaryColor: string;
  termsOfUse: string;
  privacyNotice: string;
  privacyContact: string;
  welcomeText: string;
  guestDurationMin: number;
  guestQuotaMB: number;
  guestBaseUrl: string; // self-service URL (e.g. https://wifi.example.com); "" = same host
}

const DEFAULT_SETTINGS: SystemSettings = {
  brandName: "Guest WiFi Portal",
  logoUrl: null,
  backgroundUrl: null,
  primaryColor: "#171717",
  termsOfUse:
    "By connecting to this network you accept the terms of use and data handling policy. " +
    "Traffic on this network is categorised by application/service type (not content or " +
    "browsing history) for capacity and security purposes, visible only to authorised " +
    "administrators.",
  privacyNotice: "",
  privacyContact: "",
  welcomeText: "Welcome",
  guestDurationMin: 480,
  guestQuotaMB: 0,
  guestBaseUrl: "",
};

// Only expose the fields safe for public/client rendering — the underlying
// row also holds UniFi controller and admin credentials.
function publicFields(settings: {
  brandName: string;
  logoUrl: string | null;
  backgroundUrl: string | null;
  primaryColor: string;
  termsOfUse: string;
  privacyNotice: string;
  privacyContact: string;
  welcomeText: string;
  guestDurationMin: number;
  guestQuotaMB: number;
  guestBaseUrl: string | null;
}): SystemSettings {
  return {
    brandName: settings.brandName,
    logoUrl: settings.logoUrl,
    backgroundUrl: settings.backgroundUrl,
    primaryColor: settings.primaryColor,
    termsOfUse: settings.termsOfUse,
    privacyNotice: settings.privacyNotice,
    privacyContact: settings.privacyContact,
    welcomeText: settings.welcomeText,
    guestDurationMin: settings.guestDurationMin,
    guestQuotaMB: settings.guestQuotaMB,
    guestBaseUrl: settings.guestBaseUrl || "",
  };
}

export async function getSystemSettings(): Promise<SystemSettings> {
  try {
    // Served from the shared settings-row cache. This used to upsert on
    // every call, which took a write lock on the config row per request,
    // needless contention on the registration hot path. The create now only
    // runs on genuine first boot, when no row exists yet.
    const cached = await getSettingsRow();
    if (cached) return publicFields(cached);
    const row = await prisma.systemSettings.upsert({
      where: { id: "config" },
      update: {},
      create: { id: "config", ...DEFAULT_SETTINGS },
    });
    primeSettingsRow(row);
    return publicFields(row);
  } catch (error) {
    // Prisma's upsert is find-then-create, so two concurrent first-boot
    // requests can both attempt the create and one loses with P2002 — the
    // row exists by then, so read it rather than serving defaults.
    if ((error as { code?: string })?.code === "P2002") {
      const row = await prisma.systemSettings.findUnique({ where: { id: "config" } }).catch(() => null);
      if (row) {
        primeSettingsRow(row);
        return publicFields(row);
      }
    }
    console.error("Error fetching settings:", error);
    return DEFAULT_SETTINGS;
  }
}
