import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { revokeDevice, DeviceOpError } from "@/lib/deviceOps";
import { canonicalizeMac } from "@/lib/mac";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const rawMac = typeof body.mac === "string" ? body.mac : "";
  const phone = typeof body.phone === "string" ? body.phone : undefined;
  if (!rawMac) return NextResponse.json({ error: "MAC address missing" }, { status: 400 });
  // UniFi's live client list is the usual source for this route's `mac` (no
  // canonicalization there), so fall back to a plain lowercase trim if it
  // doesn't parse as a strict MAC, rather than rejecting the request.
  const mac = canonicalizeMac(rawMac) ?? rawMac.trim().toLowerCase();

  try {
    await revokeDevice(mac, phone);
    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: "guest.revoke",
      target: mac,
      detail: phone ? { phone } : null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof DeviceOpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
