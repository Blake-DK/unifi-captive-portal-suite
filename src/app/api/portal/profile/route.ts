import { NextRequest, NextResponse } from "next/server";
import { requireGuestPhone } from "@/lib/guestAuth";
import { getProfileForPhone, updateProfileForPhone } from "@/lib/guestProfile";
import { guestProfileUpdateSchema } from "@/lib/validators";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const phone = await requireGuestPhone(req);
  if (!phone) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getProfileForPhone(phone);
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(profile);
}

export async function PATCH(req: NextRequest) {
  const phone = await requireGuestPhone(req);
  if (!phone) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = guestProfileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  await updateProfileForPhone(phone, {
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    email: parsed.data.email || null,
  });

  audit(req, { actorType: "guest", actor: phone, action: "guest.profile_update", target: phone });
  return NextResponse.json({ ok: true });
}
