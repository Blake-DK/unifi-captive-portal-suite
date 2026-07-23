import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { listDevices } from "@/lib/unifi";
import { traceUplinkChain } from "@/lib/vlanTrace";
import { canonicalizeMac } from "@/lib/mac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The device's uplink path for the device dialog, root first. Each entry's
 * `port` is the port on THAT device where the next element toward the target
 * (or the target itself, for the last entry) is attached.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const { mac: raw } = await ctx.params;
  const mac = canonicalizeMac(decodeURIComponent(raw));
  if (!mac) return NextResponse.json({ error: "Invalid MAC" }, { status: 400 });

  try {
    const devices = await listDevices();
    const device = devices.find((d) => d.mac.toLowerCase() === mac);
    if (!device) return NextResponse.json({ error: "Unknown device" }, { status: 404 });
    const path = traceUplinkChain(devices, device)
      .map((h) => ({
        mac: h.device.mac,
        name: h.device.name || h.device.mac,
        port: h.portIdx ?? null,
        wireless: Boolean(h.wireless),
      }))
      .reverse();
    return NextResponse.json({ path });
  } catch (err) {
    const message = err instanceof Error ? err.message : "UniFi request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
