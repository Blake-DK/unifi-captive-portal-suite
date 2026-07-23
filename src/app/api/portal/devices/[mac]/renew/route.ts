import { NextRequest, NextResponse } from "next/server";
import { jsonSafe } from "@/lib/utils";
import { canonicalizeMac } from "@/lib/mac";
import { requireGuestPhone } from "@/lib/guestAuth";
import { renewDeviceForPhone, DeviceOpError } from "@/lib/deviceOps";
import { clientIp } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ mac: string }> }) {
  const phone = await requireGuestPhone(req);
  if (!phone) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mac = canonicalizeMac(decodeURIComponent((await params).mac));
  if (!mac) return NextResponse.json({ error: "Invalid MAC address" }, { status: 400 });

  try {
    const device = await renewDeviceForPhone(phone, mac, {
      userAgent: req.headers.get("user-agent") ?? undefined,
      ipAddress: clientIp(req),
    });
    audit(req, { actorType: "guest", actor: phone, action: "guest.device_renew", target: mac });
    return NextResponse.json(jsonSafe({ ok: true, device }));
  } catch (err) {
    if (err instanceof DeviceOpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
