import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { listDevices } from "@/lib/unifi";
import { jsonSafe } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The controller's raw stat/device row for one MAC, untouched by our
 * UniFiDeviceHealth projection. Diagnostic surface: field availability varies
 * by model and firmware (temperature/fan/PSU in particular), so feature work
 * verifies against this dump instead of assuming. Settings-gated; `x_`-prefixed
 * fields are stripped because the controller marks its private material
 * (SSH/auth keys) with that prefix.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const mac = decodeURIComponent((await ctx.params).mac).toLowerCase();
  const row = (await listDevices()).find((d) => d.mac?.toLowerCase() === mac);
  if (!row) return NextResponse.json({ error: "Device not found" }, { status: 404 });

  const scrubbed = Object.fromEntries(
    Object.entries(row as Record<string, unknown>).filter(([k]) => !k.startsWith("x_")),
  );
  return NextResponse.json(jsonSafe(scrubbed));
}
