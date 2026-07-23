import { NextRequest, NextResponse } from "next/server";
import { getPortalConfig } from "@/lib/config";
import { probeIntegrationApi } from "@/lib/unifi";
import { requireAdmin } from "@/lib/adminGuard";

export const runtime = "nodejs";

/**
 * Probe the optional Integration-API key (GET /integration/v1/sites) and
 * report which auth each portal capability resolves to. The Integration API
 * is a read subset, so most capabilities are always "local" — the table makes
 * that limitation visible instead of implying the key replaces the account.
 */
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const cfg = await getPortalConfig();
  if (!cfg.unifiApiKey) {
    return NextResponse.json({
      success: false,
      error: "No API key is saved yet — enter one above and save settings first.",
    });
  }

  const probe = await probeIntegrationApi();
  const keyOk = probe.ok;
  const siteNames = (probe.sites ?? [])
    .map((s) => s.name || s.internalReference || s.id)
    .slice(0, 10);

  const capabilities = [
    { name: "Sites / clients / devices (monitoring reads)", auth: keyOk ? "API key (cookie fallback)" : "local account" },
    { name: "Guest authorization (bandwidth/quota)", auth: "local account" },
    { name: "Client notes & user-group throttle", auth: "local account" },
    { name: "Sessions, events, DPI/traffic, reports", auth: "local account" },
    { name: "Hotspot / WLAN configuration", auth: "local account" },
  ];

  return NextResponse.json({
    success: keyOk,
    status: probe.status,
    error: probe.error,
    siteCount: probe.sites?.length,
    siteNames,
    capabilities,
  });
}
