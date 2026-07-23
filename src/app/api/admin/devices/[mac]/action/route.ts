import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { canonicalizeMac } from "@/lib/mac";
import { listDevices, restartDevice, powerCyclePort, locateDevice } from "@/lib/unifi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Device remote control: restart, PoE port power-cycle, locate. Full-admin
 * only (monitors/operators can view the map but not reset hardware). The MAC
 * must resolve to a real adopted device, so a caller can't aim these at an
 * arbitrary address.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;

  const { mac: rawMac } = await ctx.params;
  const mac = canonicalizeMac(decodeURIComponent(rawMac));
  if (!mac) return NextResponse.json({ error: "Invalid MAC" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";
  const portIdx = Number(body.portIdx);

  const device = (await listDevices().catch(() => [])).find((d) => d.mac.toLowerCase() === mac);
  if (!device) return NextResponse.json({ error: "Unknown device" }, { status: 404 });

  const auditBase = { actorType: "admin" as const, actor: session.sub, target: mac };
  try {
    switch (action) {
      case "restart":
        await restartDevice(mac);
        audit(req, { ...auditBase, action: "device.restart", detail: { name: device.name } });
        return NextResponse.json({ ok: true, message: `Restarting ${device.name || mac}` });
      case "power-cycle":
        if (!Number.isInteger(portIdx) || portIdx < 1) {
          return NextResponse.json({ error: "A valid port number is required" }, { status: 400 });
        }
        await powerCyclePort(mac, portIdx);
        audit(req, { ...auditBase, action: "device.power_cycle", detail: { name: device.name, portIdx } });
        return NextResponse.json({ ok: true, message: `Power-cycling port ${portIdx} on ${device.name || mac}` });
      case "locate-on":
      case "locate-off":
        await locateDevice(mac, action === "locate-on");
        audit(req, { ...auditBase, action: "device.locate", detail: { name: device.name, on: action === "locate-on" } });
        return NextResponse.json({ ok: true, message: `Locate ${action === "locate-on" ? "on" : "off"} for ${device.name || mac}` });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Device command failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
