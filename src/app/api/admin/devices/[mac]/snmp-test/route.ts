import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { listDevices } from "@/lib/unifi";
import { credsFromSettings, hasPollableIp } from "@/lib/snmpFallback";
import { probeTarget } from "@/lib/snmp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Probe ONE specific device by MAC — the targeted counterpart of
 * /api/admin/snmp-test's fixed 3-device sample. Useful when diagnosing
 * whether an SNMP timeout is isolated to one device or shared across a
 * VLAN/subnet: pick a second device on the same network from its window and
 * test it directly, rather than waiting for the fleet sample to land on it.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const s = await prisma.systemSettings.findUnique({ where: { id: "config" } });
  if (!s?.snmpEnabled) {
    return NextResponse.json({ error: "SNMP fallback is disabled — enable it in Settings → Monitoring first." }, { status: 400 });
  }
  if (!s.snmpUser || !s.snmpAuthKey || !s.snmpPrivKey) {
    return NextResponse.json({ error: "SNMP user and both keys are required." }, { status: 400 });
  }

  const mac = decodeURIComponent((await ctx.params).mac).toLowerCase();
  let devices;
  try {
    devices = await listDevices();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Controller unreachable" }, { status: 502 });
  }
  const device = devices.find((d) => d.mac?.toLowerCase() === mac);
  if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });
  if (!hasPollableIp(device.ip)) {
    return NextResponse.json(
      { error: `${device.ip ? `${device.ip} is not a private/LAN address` : "No IP reported"} — not SNMP-pollable from here.` },
      { status: 400 },
    );
  }

  const result = await probeTarget({ mac, ip: device.ip }, credsFromSettings(s));
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "snmp.test_device",
    target: mac,
    detail: { name: device.name ?? mac, ip: device.ip, reachable: result.reachable },
  });

  return NextResponse.json({ reachable: result.reachable, ip: device.ip, error: result.error ?? null });
}
