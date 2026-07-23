import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { canonicalizeMac } from "@/lib/mac";
import { blockStation, unblockStation } from "@/lib/unifi";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Block a client from the network (UniFi cmd/stamgr block-sta) with a
 * required reason, recorded alongside who and when. Full-admin only, same
 * gating as the other device remote-controls.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;

  const { mac: rawMac } = await ctx.params;
  const mac = canonicalizeMac(decodeURIComponent(rawMac));
  if (!mac) return NextResponse.json({ error: "Invalid MAC" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason || reason.length > 200) {
    return NextResponse.json({ error: "A reason (max 200 chars) is required" }, { status: 400 });
  }

  try {
    await blockStation(mac);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Device command failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const blocked = await prisma.blockedDevice.upsert({
    where: { mac },
    create: { mac, reason, blockedBy: session.sub },
    update: { reason, blockedBy: session.sub, blockedAt: new Date() },
  });

  audit(req, { actorType: "admin", actor: session.sub, action: "device.block", target: mac, detail: { reason } });
  return NextResponse.json({ ok: true, blocked });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;

  const { mac: rawMac } = await ctx.params;
  const mac = canonicalizeMac(decodeURIComponent(rawMac));
  if (!mac) return NextResponse.json({ error: "Invalid MAC" }, { status: 400 });

  try {
    await unblockStation(mac);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Device command failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const existing = await prisma.blockedDevice.findUnique({ where: { mac } });
  await prisma.blockedDevice.delete({ where: { mac } }).catch(() => null);

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "device.unblock",
    target: mac,
    detail: existing ? { reason: existing.reason, blockedBy: existing.blockedBy } : undefined,
  });
  return NextResponse.json({ ok: true });
}
