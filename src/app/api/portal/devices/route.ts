import { NextRequest, NextResponse } from "next/server";
import { jsonSafe } from "@/lib/utils";
import { canonicalizeMac } from "@/lib/mac";
import { requireGuestPhone } from "@/lib/guestAuth";
import { getActiveDevicesForPhone } from "@/lib/guestDevices";
import { addDeviceForPhone, DeviceOpError } from "@/lib/deviceOps";
import { clientIp } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const phone = await requireGuestPhone(req);
  if (!phone) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const devices = await getActiveDevicesForPhone(phone);
  return NextResponse.json(jsonSafe({ devices }));
}

export async function POST(req: NextRequest) {
  const phone = await requireGuestPhone(req);
  if (!phone) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const mac = canonicalizeMac(typeof body.mac === "string" ? body.mac : "");
  if (!mac) return NextResponse.json({ error: "Invalid MAC address" }, { status: 400 });
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 40) || null : null;

  try {
    const created = await addDeviceForPhone(phone, mac, {
      label,
      userAgent: req.headers.get("user-agent") ?? undefined,
      ipAddress: clientIp(req),
    });
    audit(req, {
      actorType: "guest",
      actor: phone,
      action: "guest.device_add",
      target: mac,
      detail: { label },
    });
    return NextResponse.json(jsonSafe({ ok: true, device: created }));
  } catch (err) {
    if (err instanceof DeviceOpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
