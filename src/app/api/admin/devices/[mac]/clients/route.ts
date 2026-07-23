import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { listStations } from "@/lib/unifi";
import { canonicalizeMac, isLocallyAdministeredMac } from "@/lib/mac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Clients currently connected to one device: wireless stations whose ap_mac
 * matches, wired stations whose sw_mac matches. Feeds the device dialog's
 * "Connected clients" list. Vendor is the controller's OUI resolution; a
 * locally-administered MAC has a fabricated prefix, so it reports as a
 * randomised MAC instead of a manufacturer.
 */

export async function GET(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const { mac: raw } = await ctx.params;
  const mac = canonicalizeMac(decodeURIComponent(raw));
  if (!mac) return NextResponse.json({ error: "Invalid MAC" }, { status: 400 });

  try {
    const stations = await listStations();
    const clients = stations
      .filter((s) => s.ap_mac?.toLowerCase() === mac || s.sw_mac?.toLowerCase() === mac)
      .map((s) => ({
        mac: s.mac,
        name: s.name || s.hostname || "",
        ip: s.ip ?? null,
        vendor: s.oui || (isLocallyAdministeredMac(s.mac) ? "(randomised MAC)" : ""),
        wired: Boolean(s.is_wired),
        essid: s.essid ?? null,
        rssi: s.rssi ?? null,
        port: s.sw_port ?? null,
      }))
      .sort((a, b) => (a.name || a.mac).localeCompare(b.name || b.mac));
    return NextResponse.json({ clients });
  } catch (err) {
    const message = err instanceof Error ? err.message : "UniFi request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
