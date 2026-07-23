import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const planInt = (v: unknown): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Optional `?since=`/`?until=` (ISO timestamps) scope to events whose
 * [startsAt, endsAt] window overlaps the given range, instead of the fixed
 * 200-row cap — used by the assurance timeline to match its chart range.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const since = sp.get("since") ? new Date(sp.get("since")!) : null;
  const until = sp.get("until") ? new Date(sp.get("until")!) : null;
  const windowed = Boolean(since || until);
  const where: Record<string, unknown> = {};
  if (since) where.endsAt = { gte: since };
  if (until) where.startsAt = { lte: until };

  // Each event with its tagged-registration and distinct-device/guest counts.
  const events = await prisma.event.findMany({
    where,
    orderBy: { startsAt: "desc" },
    ...(windowed ? {} : { take: 200 }),
  });
  const withCounts = await Promise.all(
    events.map(async (e) => {
      const [registrations, devices, guests] = await Promise.all([
        prisma.guestRegistration.count({ where: { eventId: e.id } }),
        prisma.guestRegistration.findMany({ where: { eventId: e.id }, select: { macAddress: true }, distinct: ["macAddress"] }),
        prisma.guestRegistration.findMany({ where: { eventId: e.id }, select: { phone: true }, distinct: ["phone"] }),
      ]);
      return { ...e, registrations, devices: devices.length, guests: guests.length };
    }),
  );
  return NextResponse.json({ events: withCounts });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) {
    return NextResponse.json({ error: "An event name (max 80 chars) is required" }, { status: 400 });
  }
  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);
  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    return NextResponse.json({ error: "Valid start and end times are required (end after start)" }, { status: 400 });
  }

  const created = await prisma.event.create({
    data: {
      name,
      startsAt,
      endsAt,
      note: typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null,
      durationMin: planInt(body.durationMin),
      downKbps: planInt(body.downKbps),
      upKbps: planInt(body.upKbps),
      quotaMB: planInt(body.quotaMB),
      createdBy: session.sub,
    },
  });

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "event.create",
    target: created.name,
    detail: { id: created.id, startsAt, endsAt },
  });
  return NextResponse.json({ event: created });
}
