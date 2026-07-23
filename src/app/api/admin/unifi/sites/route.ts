import { NextRequest, NextResponse } from "next/server";
import { getPortalConfig } from "@/lib/config";
import { listIntegrationSites } from "@/lib/unifi";
import { requireAdmin } from "@/lib/adminGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List the controller's sites via the Integration API key so the settings
 * page can offer a picker instead of hand-typed site names. The classic
 * short name the portal stores in `unifiSite` is the Integration API's
 * `internalReference`.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const cfg = await getPortalConfig();
  if (!cfg.unifiApiKey) {
    return NextResponse.json({
      sites: [],
      error: "No Integration API key is saved — sites can only be listed with one. Set a key below and save settings first.",
    });
  }

  try {
    const sites = (await listIntegrationSites()).map((s) => ({
      id: s.id,
      internalReference: s.internalReference ?? null,
      name: s.name ?? null,
    }));
    return NextResponse.json({ sites });
  } catch (e) {
    return NextResponse.json({
      sites: [],
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
