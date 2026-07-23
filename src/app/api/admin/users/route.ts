import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonSafe } from "@/lib/utils";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { listUsersPage } from "@/lib/adminUsers";
import { adminCreateUserSchema, onlyDigits } from "@/lib/validators";
import { canonicalizeMac } from "@/lib/mac";
import { authorizeGuest, guestClientNote } from "@/lib/unifi";
import { getPortalConfig } from "@/lib/config";
import { isRegistrationActive } from "@/lib/guestDevices";
import { resolveLocationForRegistration } from "@/lib/locations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(sp.get("pageSize") ?? "20", 10)));

  const { rows, total } = await listUsersPage({ q, page, pageSize });
  return NextResponse.json(jsonSafe({ rows, total, page, pageSize }));
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const parsed = adminCreateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const phone = onlyDigits(data.phone);
  const mac = canonicalizeMac(data.mac);
  if (!mac) return NextResponse.json({ error: "Invalid MAC address" }, { status: 400 });

  const existing = await prisma.guestRegistration.findFirst({
    where: { macAddress: mac, revokedAt: null },
    orderBy: { authorizedAt: "desc" },
  });
  if (existing && isRegistrationActive(existing)) {
    return NextResponse.json({ error: "This device is already registered" }, { status: 409 });
  }

  const { location, error: locationError } = await resolveLocationForRegistration(
    data.locationId,
    data.building,
  );
  if (locationError) {
    return NextResponse.json({ error: locationError }, { status: 400 });
  }

  const cfg = await getPortalConfig();

  const created = await prisma.guestRegistration.create({
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email || null,
      phone,
      macAddress: mac,
      label: data.label?.trim() || null,
      locationType: location?.name ?? "none",
      locationId: location?.id ?? null,
      locationName: location?.name ?? null,
      building: data.building?.trim() || null,
      roomNumber: data.roomNumber?.trim() || null,
      durationMin: cfg.guestDurationMin,
      downKbps: cfg.guestDownKbps || undefined,
      upKbps: cfg.guestUpKbps || undefined,
    },
  });

  try {
    await authorizeGuest({
      mac,
      minutes: cfg.guestDurationMin,
      downKbps: cfg.guestDownKbps || undefined,
      upKbps: cfg.guestUpKbps || undefined,
      bytesQuotaMB: cfg.guestQuotaMB || undefined,
      apMac: null,
      note: guestClientNote(data.firstName, data.lastName, phone),
    });
  } catch (err) {
    await prisma.guestRegistration.delete({ where: { id: created.id } }).catch(() => {});
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Could not authorize device: ${message}` }, { status: 502 });
  }

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "guest.create",
    target: phone,
    detail: { mac, locationName: location?.name ?? null },
  });

  return NextResponse.json(jsonSafe({ ok: true, phone }));
}
