import { NextRequest, NextResponse } from "next/server";
import { jsonSafe } from "@/lib/utils";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { canonicalizeMac } from "@/lib/mac";
import { addDeviceForPhone, DeviceOpError } from "@/lib/deviceOps";
import { clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ phone: string }> }) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;

  const { phone } = await params;
  const body = await req.json().catch(() => ({}));
  const mac = canonicalizeMac(typeof body.mac === "string" ? body.mac : "");
  if (!mac) return NextResponse.json({ error: "Invalid MAC address" }, { status: 400 });
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 40) || null : null;

  try {
    const device = await addDeviceForPhone(decodeURIComponent(phone), mac, {
      label,
      userAgent: req.headers.get("user-agent") ?? undefined,
      ipAddress: clientIp(req),
    });
    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: "guest.device_add",
      target: mac,
      detail: { phone: decodeURIComponent(phone), label },
    });
    return NextResponse.json(jsonSafe({ ok: true, device }));
  } catch (err) {
    if (err instanceof DeviceOpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
