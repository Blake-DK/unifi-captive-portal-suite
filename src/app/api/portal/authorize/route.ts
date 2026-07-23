import { NextRequest, NextResponse } from "next/server";
import { guestRegistrationSchema } from "@/lib/validators";
import { registerGuest, RegistrationError } from "@/lib/registerGuest";
import { clientIp } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

// Thin wrapper: parse + validate, then the shared registration core (also
// used by the sponsored-access approval path) does the work.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = guestRegistrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await registerGuest(parsed.data, {
      userAgent: req.headers.get("user-agent") ?? undefined,
      ipAddress: clientIp(req),
      origin: req.nextUrl.origin,
    });
  } catch (err) {
    if (err instanceof RegistrationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  audit(req, {
    actorType: "guest",
    actor: result.phone,
    action: "guest.register",
    target: result.mac,
    detail: {
      locationId: result.locationId,
      locationName: result.locationName,
      ssid: result.ssid,
      verifyPending: result.verifyPending,
      grantedMin: result.grantedMin,
      voucherId: result.voucherId,
    },
  });

  return NextResponse.json({
    ok: true,
    id: result.id,
    redirect: result.redirect,
    magicToken: result.magicToken,
    verifyPending: result.verifyPending,
    grantedMin: result.grantedMin,
  });
}
