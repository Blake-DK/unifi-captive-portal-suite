import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { canonicalizeMac } from "@/lib/mac";
import { throttleClient, unthrottleClient } from "@/lib/unifi";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_KBPS = 1_000_000; // 1 Gbps ceiling on the requested cap

/**
 * Rate-limit a client via a UniFi user group — a gentler alternative to a hard
 * block. Full-admin only, same gating as block. The controller call runs first;
 * only on success is the local ThrottledDevice record written (so a failed
 * controller call doesn't leave a misleading "throttled" state).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;

  const { mac: rawMac } = await ctx.params;
  const mac = canonicalizeMac(decodeURIComponent(rawMac));
  if (!mac) return NextResponse.json({ error: "Invalid MAC" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const downKbps = Math.round(Number(body.downKbps));
  const upKbps = Math.round(Number(body.upKbps));
  if (!Number.isFinite(downKbps) || !Number.isFinite(upKbps) || downKbps < 64 || upKbps < 64) {
    return NextResponse.json({ error: "Down/up must each be at least 64 Kbps" }, { status: 400 });
  }
  if (downKbps > MAX_KBPS || upKbps > MAX_KBPS) {
    return NextResponse.json({ error: "Rate is unreasonably high" }, { status: 400 });
  }

  try {
    await throttleClient(mac, downKbps, upKbps);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Throttle failed" },
      { status: 502 },
    );
  }

  const throttled = await prisma.throttledDevice.upsert({
    where: { mac },
    create: { mac, downKbps, upKbps, throttledBy: session.sub },
    update: { downKbps, upKbps, throttledBy: session.sub, throttledAt: new Date() },
  });
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "device.throttle",
    target: mac,
    detail: { downKbps, upKbps },
  });
  return NextResponse.json({ ok: true, throttled });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;

  const { mac: rawMac } = await ctx.params;
  const mac = canonicalizeMac(decodeURIComponent(rawMac));
  if (!mac) return NextResponse.json({ error: "Invalid MAC" }, { status: 400 });

  try {
    await unthrottleClient(mac);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Un-throttle failed" },
      { status: 502 },
    );
  }

  await prisma.throttledDevice.delete({ where: { mac } }).catch(() => null);
  audit(req, { actorType: "admin", actor: session.sub, action: "device.unthrottle", target: mac });
  return NextResponse.json({ ok: true });
}
