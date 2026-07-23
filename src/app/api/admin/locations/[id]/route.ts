import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { planInt } from "@/lib/locations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function locationFromParams(params: Promise<{ id: string }>) {
  const { id: raw } = await params;
  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return prisma.location.findUnique({ where: { id } });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const existing = await locationFromParams(ctx.params);
  if (!existing) return NextResponse.json({ error: "Location not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name || name.length > 60) {
      return NextResponse.json({ error: "A location name (max 60 chars) is required" }, { status: 400 });
    }
    data.name = name;
  }
  if ("logoUrl" in body) data.logoUrl = typeof body.logoUrl === "string" && body.logoUrl ? body.logoUrl : null;
  if (typeof body.buildings === "string") data.buildings = body.buildings;
  if ("buildingFreeText" in body) data.buildingFreeText = Boolean(body.buildingFreeText);
  if ("isHotel" in body) data.isHotel = Boolean(body.isHotel);
  if ("sortOrder" in body) data.sortOrder = Math.round(Number(body.sortOrder) || 0);
  if ("retentionMode" in body) data.retentionMode = body.retentionMode === "anonymize" ? "anonymize" : "forever";
  if ("retentionDays" in body) data.retentionDays = Math.max(0, Math.round(Number(body.retentionDays) || 0));
  for (const key of ["durationMin", "downKbps", "upKbps", "quotaMB", "maxDevices"] as const) {
    if (key in body) data[key] = planInt(body[key]);
  }

  const updated = await prisma.location.update({ where: { id: existing.id }, data });

  // Field names only, matching the settings.update audit convention.
  const changed = Object.keys(data).filter(
    (k) => existing[k as keyof typeof existing] !== data[k],
  );
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "location.update",
    target: updated.name,
    detail: { id: updated.id, changed },
  });

  return NextResponse.json({ location: updated });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const existing = await locationFromParams(ctx.params);
  if (!existing) return NextResponse.json({ error: "Location not found" }, { status: 404 });

  // Registrations keep their locationName snapshot; the FK nulls out.
  await prisma.location.delete({ where: { id: existing.id } });

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "location.delete",
    target: existing.name,
    detail: { id: existing.id },
  });

  return NextResponse.json({ ok: true });
}
