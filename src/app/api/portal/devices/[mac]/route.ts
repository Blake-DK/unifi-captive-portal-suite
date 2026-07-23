import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonSafe } from "@/lib/utils";
import { canonicalizeMac } from "@/lib/mac";
import { requireGuestPhone } from "@/lib/guestAuth";
import { revokeDevice, DeviceOpError } from "@/lib/deviceOps";
import { audit } from "@/lib/audit";
import { z } from "zod";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ mac: string }> }) {
  const phone = await requireGuestPhone(req);
  if (!phone) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mac = canonicalizeMac(decodeURIComponent((await params).mac));
  if (!mac) return NextResponse.json({ error: "Invalid MAC address" }, { status: 400 });

  try {
    await revokeDevice(mac, phone);
  } catch (err) {
    if (err instanceof DeviceOpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  audit(req, { actorType: "guest", actor: phone, action: "guest.device_remove", target: mac });
  return NextResponse.json({ ok: true });
}

const labelSchema = z.object({ label: z.string().trim().max(40, "Label too long").nullable() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ mac: string }> }) {
  const phone = await requireGuestPhone(req);
  if (!phone) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mac = canonicalizeMac(decodeURIComponent((await params).mac));
  if (!mac) return NextResponse.json({ error: "Invalid MAC address" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const parsed = labelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid label" }, { status: 400 });
  }

  // Target the single active row for this MAC (getActiveDevicesForPhone
  // already dedupes to one per MAC — this is the row the guest sees/edits).
  const row = await prisma.guestRegistration.findFirst({
    where: { phone, macAddress: mac, revokedAt: null },
    orderBy: { authorizedAt: "desc" },
  });
  if (!row) return NextResponse.json({ error: "Device not found" }, { status: 404 });

  const updated = await prisma.guestRegistration.update({
    where: { id: row.id },
    data: { label: parsed.data.label || null },
  });

  audit(req, {
    actorType: "guest",
    actor: phone,
    action: "guest.device_label",
    target: mac,
    detail: { label: parsed.data.label || null },
  });
  return NextResponse.json(jsonSafe({ ok: true, device: updated }));
}
