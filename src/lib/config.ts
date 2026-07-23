import { getSettingsRow } from "./settingsRow";
import { decryptSecret } from "./secrets";

export type UniFiAccount = { username: string; password: string };

export interface PortalConfig {
  unifiUrl: string;
  unifiUsername: string;
  unifiPassword: string;
  /** Login accounts in failover order — the primary plus any complete backup
   * slots (both username and password set). Optional so hand-built configs
   * (tests) keep working; consumers fall back to the primary fields. */
  unifiAccounts?: UniFiAccount[];
  unifiSite: string;
  unifiInsecureTls: boolean;
  unifiApiType: string;
  /** Optional Integration-API key (UniFi OS 4+); supplements the local account. */
  unifiApiKey: string;
  guestDurationMin: number;
  guestDownKbps: number;
  guestUpKbps: number;
  portalSuccessUrl: string;
  portalBaseUrl: string;
  portalTargetIp: string;
  guestBaseUrl: string;
  adminBaseUrl: string;
  reverseProxyMode: string;
  /** Comma-separated IPs/CIDRs that must never lose connectivity (firewall-apply guard). */
  criticalAddresses: string;
  /** Comma-separated controller network ids marked PCI-scoped (POS networks). */
  pciNetworkIds: string;
  maxDevicesPerPhone: number;
  guestQuotaMB: number;
  cookieSecure: boolean;
}

export async function getPortalConfig(): Promise<PortalConfig> {
  let db: Record<string, unknown> | null = null;
  try {
    db = await getSettingsRow();
  } catch {}

  // Failover account list: primary first, then each backup slot that has both
  // a username and a decryptable password.
  const accounts: UniFiAccount[] = [];
  for (const [u, p] of [
    [db?.unifiUsername, db?.unifiPassword],
    [db?.unifiUsername2, db?.unifiPassword2],
    [db?.unifiUsername3, db?.unifiPassword3],
    [db?.unifiUsername4, db?.unifiPassword4],
  ]) {
    const username = (u as string) || "";
    const password = decryptSecret(p as string) || "";
    if (username && password) accounts.push({ username, password });
  }

  return {
    unifiUrl:         (db?.unifiUrl      as string)  || "",
    unifiUsername:    (db?.unifiUsername as string)  || "",
    unifiPassword:    decryptSecret(db?.unifiPassword as string) || "",
    unifiAccounts:    accounts,
    unifiSite:        (db?.unifiSite     as string)  || "default",
    unifiInsecureTls: (db?.unifiInsecureTls as boolean) ?? false,
    guestDurationMin: (db?.guestDurationMin as number) ?? 480,
    guestDownKbps:    (db?.guestDownKbps    as number) ?? 0,
    guestUpKbps:      (db?.guestUpKbps      as number) ?? 0,
    portalSuccessUrl: (db?.portalSuccessUrl as string) || "",
    portalBaseUrl:    (db?.portalBaseUrl    as string) || "",
    portalTargetIp:   (db?.portalTargetIp   as string) || "",
    guestBaseUrl:     (db?.guestBaseUrl     as string) || "",
    adminBaseUrl:     (db?.adminBaseUrl     as string) || "",
    reverseProxyMode: (db?.reverseProxyMode as string) || "none",
    criticalAddresses: (db?.criticalAddresses as string) || "",
    pciNetworkIds:    (db?.pciNetworkIds as string) || "",
    unifiApiType:     (db?.unifiApiType     as string) || "auto",
    unifiApiKey:      decryptSecret(db?.unifiApiKey as string) || "",
    maxDevicesPerPhone: (db?.maxDevicesPerPhone as number) ?? 5,
    guestQuotaMB:       (db?.guestQuotaMB       as number) ?? 0,
    cookieSecure:       (db?.cookieSecure as boolean) ?? false,
  };
}

/**
 * Lean read for the four cookie-setting call sites: avoids the full
 * config's decryptSecret calls on hot login paths. Served from the cached
 * settings row. `null` (not yet configured, or upgrading from an unmigrated
 * deployment) reads as `false`, same as the full config above.
 */
export async function getCookieSecure(): Promise<boolean> {
  try {
    const s = await getSettingsRow();
    return s?.cookieSecure ?? false;
  } catch {
    return false;
  }
}
