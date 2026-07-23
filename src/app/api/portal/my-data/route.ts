import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { GUEST_COOKIE, verifyGuestSessionToken } from "@/lib/guestAuth";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Guest self-service data export (Cloud4Wi MyData's idea): everything the
 * portal holds about the signed-in guest, as a JSON download. The admin-side
 * SAR export stays for formal requests; this is the guest helping
 * themselves.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(GUEST_COOKIE)?.value;
  const phone = await verifyGuestSessionToken(token);
  if (!phone) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const registrations = await prisma.guestRegistration.findMany({
    where: { phone },
    orderBy: { authorizedAt: "desc" },
    select: {
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      emailVerifiedAt: true,
      macAddress: true,
      ssid: true,
      locationName: true,
      building: true,
      roomNumber: true,
      authorizedAt: true,
      durationMin: true,
      revokedAt: true,
      anonymizedAt: true,
      consentTermsHash: true,
      userAgent: true,
      ipAddress: true,
    },
  });

  audit(req, {
    actorType: "guest",
    actor: phone,
    action: "guest.data_export",
    detail: { rows: registrations.length },
  });

  return NextResponse.json(
    {
      exportedAt: new Date().toISOString(),
      phone,
      registrations,
      note:
        "This is everything the guest portal stores about you. Rows with anonymizedAt set have had their personal fields cleared by the retention policy.",
    },
    {
      headers: {
        "content-disposition": `attachment; filename="my-wifi-data-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    },
  );
}
