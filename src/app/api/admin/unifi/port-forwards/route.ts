import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { loadPortForwards } from "@/lib/portForwards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Inbound-exposure inventory: static port-forwards + dynamic UPnP leases,
 * grouped by the LAN device they target. Read-only. */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  return NextResponse.json(await loadPortForwards());
}

/** Upsert (or clear, with an empty note) the operator note on one exposure.
 * Settings-gated: annotating the firewall posture is an admin action. */
export async function PUT(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : "";
  if (!key) return NextResponse.json({ error: "A port-forward key is required" }, { status: 400 });

  if (!note) {
    await prisma.portForwardNote.deleteMany({ where: { key } });
    audit(req, { actorType: "admin", actor: session.sub, action: "portforward.note.clear", target: key });
    return NextResponse.json({ ok: true, note: "" });
  }

  await prisma.portForwardNote.upsert({
    where: { key },
    update: { note, updatedBy: session.sub, updatedAt: new Date() },
    create: { key, note, updatedBy: session.sub },
  });
  audit(req, { actorType: "admin", actor: session.sub, action: "portforward.note", target: key, detail: { note } });
  return NextResponse.json({ ok: true, note });
}
