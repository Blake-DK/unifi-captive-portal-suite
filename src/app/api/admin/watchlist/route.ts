import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { canonicalizeMac } from "@/lib/mac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Add a client to the watchlist: the alert monitor opens a watched_client
 * alert whenever it connects (Catalyst's client-tracking idea). */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;
  let body: { mac?: unknown; note?: unknown; expiresDays?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const mac = canonicalizeMac(String(body.mac ?? ""));
  if (!mac) return NextResponse.json({ error: "Invalid MAC" }, { status: 400 });
  const days = Math.round(Number(body.expiresDays));
  const expiresAt =
    Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000) : null;
  const note = String(body.note ?? "").slice(0, 200);

  await prisma.watchedClient.upsert({
    where: { mac },
    create: { mac, note, createdBy: session.sub, expiresAt },
    update: { note, expiresAt },
  });
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "client.watch",
    target: mac,
    detail: { note, expiresDays: expiresAt ? days : null },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;
  const mac = canonicalizeMac(req.nextUrl.searchParams.get("mac") ?? "");
  if (!mac) return NextResponse.json({ error: "Invalid MAC" }, { status: 400 });
  await prisma.watchedClient.deleteMany({ where: { mac } });
  audit(req, { actorType: "admin", actor: session.sub, action: "client.unwatch", target: mac });
  return NextResponse.json({ ok: true });
}
