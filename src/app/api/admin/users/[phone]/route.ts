import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { updateProfileForPhone } from "@/lib/guestProfile";
import { guestProfileUpdateSchema } from "@/lib/validators";
import { isRegistrationActive } from "@/lib/guestDevices";
import { unauthorizeGuest } from "@/lib/unifi";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ phone: string }> }) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;

  const { phone } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = guestProfileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const phoneDigits = decodeURIComponent(phone);
  const count = await updateProfileForPhone(phoneDigits, {
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    email: parsed.data.email || null,
  });
  if (count === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "guest.profile_update",
    target: phoneDigits,
  });
  return NextResponse.json({ ok: true });
}

/**
 * Delete a guest entirely: kick their still-active devices off the network,
 * then remove every registration row (profile, devices, history) for the
 * phone. UniFi unauthorize is best-effort — an unreachable controller must
 * not leave a half-deleted user, and the authorization would lapse at its
 * natural expiry anyway.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ phone: string }> }) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;

  const phone = decodeURIComponent((await params).phone);
  const rows = await prisma.guestRegistration.findMany({ where: { phone } });
  if (rows.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const activeMacs = [...new Set(rows.filter((r) => isRegistrationActive(r)).map((r) => r.macAddress))];
  const kicked: string[] = [];
  const failed: string[] = [];
  for (const mac of activeMacs) {
    try {
      await unauthorizeGuest(mac);
      kicked.push(mac);
    } catch {
      failed.push(mac);
    }
  }

  const { count } = await prisma.guestRegistration.deleteMany({ where: { phone } });
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "guest.delete",
    target: phone,
    detail: { deleted: count, kicked, unifiFailed: failed },
  });
  return NextResponse.json({ ok: true, deleted: count, kicked, unifiFailed: failed });
}
