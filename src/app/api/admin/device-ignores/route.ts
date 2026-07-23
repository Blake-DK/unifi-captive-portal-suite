import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { listDevices } from "@/lib/unifi";
import { listIgnoredDevices } from "@/lib/ignoredDevices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Devices ignored site-wide while offline. */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  return NextResponse.json({ rows: await listIgnoredDevices() });
}

/**
 * Ignore an offline device, or lift an ignore (`{ mac, clear: true }`).
 * Ignoring an ONLINE device is refused: the ignore would clear itself on the
 * next sweep, which reads as a silently broken button.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const mac = typeof body.mac === "string" ? body.mac.trim().toLowerCase() : "";
  const note = typeof body.note === "string" ? body.note.slice(0, 200) : "";
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) {
    return NextResponse.json({ error: "A device MAC is required" }, { status: 400 });
  }

  if (body.clear === true) {
    await prisma.ignoredDevice.deleteMany({ where: { mac } });
    audit(req, { actorType: "admin", actor: session.sub, action: "device.ignore.clear", target: mac });
    return NextResponse.json({ ok: true });
  }

  const device = (await listDevices().catch(() => [])).find((d) => d.mac.toLowerCase() === mac);
  if (device?.state === 1) {
    return NextResponse.json(
      { error: "That device is online — ignores only apply to offline devices, and clear themselves on reconnect." },
      { status: 400 },
    );
  }

  await prisma.ignoredDevice.upsert({
    where: { mac },
    update: { note, name: device?.name ?? "" },
    create: { mac, note, name: device?.name ?? "", createdBy: session.sub },
  });
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "device.ignore",
    target: device?.name || mac,
    detail: { mac, note },
  });
  return NextResponse.json({ ok: true });
}
