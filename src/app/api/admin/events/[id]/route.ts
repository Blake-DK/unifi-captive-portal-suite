import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { toCSV } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?format=csv exports the event's tagged registrations; PATCH closes it. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const rows = await prisma.guestRegistration.findMany({
    where: { eventId: id },
    orderBy: { authorizedAt: "asc" },
  });

  if (req.nextUrl.searchParams.get("format") === "csv") {
    const csv = toCSV(
      rows.map((r) => ({
        authorizedAt: r.authorizedAt.toISOString(),
        firstName: r.firstName,
        lastName: r.lastName,
        phone: r.phone,
        email: r.email ?? "",
        macAddress: r.macAddress,
        label: r.label ?? "",
        location: r.locationName ?? "",
        durationMin: r.durationMin,
      })),
      [
        { key: "authorizedAt", header: "authorizedAt" },
        { key: "firstName", header: "firstName" },
        { key: "lastName", header: "lastName" },
        { key: "phone", header: "phone" },
        { key: "email", header: "email" },
        { key: "macAddress", header: "macAddress" },
        { key: "label", header: "label" },
        { key: "location", header: "location" },
        { key: "durationMin", header: "durationMin" },
      ],
    );
    const safe = event.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="event-${safe}-${id}.csv"`,
      },
    });
  }

  return NextResponse.json({ event, registrations: rows });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  if (body.action === "close") {
    const updated = await prisma.event.update({
      where: { id },
      data: { closedAt: event.closedAt ?? new Date() },
    });
    audit(req, { actorType: "admin", actor: session.sub, action: "event.close", target: event.name, detail: { id } });
    return NextResponse.json({ event: updated });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
