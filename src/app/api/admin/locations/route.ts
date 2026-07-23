import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { listLocationsAdmin, MAX_LOCATIONS, planInt } from "@/lib/locations";
import { unknownBuildings } from "@/lib/buildings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Locations tab offers to add guest-typed buildings to the list; cap the
// per-location suggestions so one location's typo storm can't flood the page.
const MAX_UNKNOWN_BUILDINGS = 20;

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  const locations = await listLocationsAdmin();
  // What guests actually typed, grouped once for all locations. Anonymized
  // rows are excluded (retention already scrubbed them); errors degrade to
  // "no suggestions", never a broken page.
  const typed = await prisma.guestRegistration
    .groupBy({
      by: ["locationId", "building"],
      where: { locationId: { not: null }, building: { not: null }, anonymizedAt: null },
      _count: { _all: true },
    })
    .catch(() => [] as { locationId: number | null; building: string | null; _count: { _all: number } }[]);
  return NextResponse.json({
    locations: locations.map((l) => ({
      ...l,
      unknownBuildings: unknownBuildings(
        l.buildings,
        typed
          .filter((t) => t.locationId === l.id)
          .map((t) => ({ value: t.building, count: t._count._all })),
      ).slice(0, MAX_UNKNOWN_BUILDINGS),
    })),
  });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 60) {
    return NextResponse.json({ error: "A location name (max 60 chars) is required" }, { status: 400 });
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const count = await tx.location.count();
      if (count >= MAX_LOCATIONS) {
        throw new LimitError(`Location limit reached (max ${MAX_LOCATIONS})`);
      }
      const maxSort = await tx.location.aggregate({ _max: { sortOrder: true } });
      return tx.location.create({
        data: {
          name,
          logoUrl: typeof body.logoUrl === "string" && body.logoUrl ? body.logoUrl : null,
          buildings: typeof body.buildings === "string" ? body.buildings : "",
          buildingFreeText: Boolean(body.buildingFreeText),
          isHotel: Boolean(body.isHotel),
          sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
          retentionMode: body.retentionMode === "anonymize" ? "anonymize" : "forever",
          retentionDays: Math.max(0, Math.round(Number(body.retentionDays) || 0)),
          durationMin: planInt(body.durationMin),
          downKbps: planInt(body.downKbps),
          upKbps: planInt(body.upKbps),
          quotaMB: planInt(body.quotaMB),
          maxDevices: planInt(body.maxDevices),
        },
      });
    });

    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: "location.create",
      target: created.name,
      detail: { id: created.id, retentionMode: created.retentionMode },
    });
    return NextResponse.json({ location: created });
  } catch (err) {
    if (err instanceof LimitError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

class LimitError extends Error {}
