import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeGuest, guestClientNote } from "@/lib/unifi";
import { getPortalConfig } from "@/lib/config";
import { planForLocationId } from "@/lib/locations";
import { getMailSettings, isEmailVerificationActive } from "@/lib/mailer";
import { createMagicLinkToken } from "@/lib/guestAuth";
import { canonicalizeMac } from "@/lib/mac";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * "You didn't confirm your email — here's N minutes to go do it."
 * Re-authorizes a device whose guest is still unverified for the short grace
 * window, so they can reach their inbox and click the link.
 */
export async function POST(req: NextRequest) {
  const mail = await getMailSettings();
  if (!isEmailVerificationActive(mail)) {
    return NextResponse.json({ error: "Email verification is not enabled" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const mac = canonicalizeMac(typeof body.mac === "string" ? body.mac : "");
  if (!mac) return NextResponse.json({ error: "Invalid MAC address" }, { status: 400 });

  // One grace grant per window per device — the point is a short runway to
  // the inbox, not indefinite half-hour access chunks.
  if (!rateLimit(`verify-grace:${mac}`, 2, mail.emailVerifyGraceMin * 60_000)) {
    return NextResponse.json(
      { error: "Grace access was already granted — please confirm your email" },
      { status: 429 },
    );
  }

  const latest = await prisma.guestRegistration.findFirst({
    where: { macAddress: mac, revokedAt: null, anonymizedAt: null },
    orderBy: { authorizedAt: "desc" },
  });
  if (!latest?.email || latest.emailVerifiedAt) {
    return NextResponse.json({ error: "This device has nothing to confirm" }, { status: 404 });
  }

  const cfg = await getPortalConfig();
  const plan = await planForLocationId(cfg, latest.locationId);
  const minutes = mail.emailVerifyGraceMin;
  const apMac = typeof body.apMac === "string" && body.apMac ? canonicalizeMac(body.apMac) : null;

  const created = await prisma.guestRegistration.create({
    data: {
      firstName: latest.firstName,
      lastName: latest.lastName,
      email: latest.email,
      phone: latest.phone,
      macAddress: mac,
      label: latest.label,
      apMac: apMac ?? latest.apMac,
      ssid: typeof body.ssid === "string" && body.ssid ? body.ssid : latest.ssid,
      site: typeof body.site === "string" && body.site ? body.site : latest.site,
      userAgent: req.headers.get("user-agent") ?? undefined,
      ipAddress: clientIp(req),
      locationType: latest.locationType,
      baseLocation: latest.baseLocation,
      building: latest.building,
      roomNumber: latest.roomNumber,
      locationId: latest.locationId,
      locationName: latest.locationName,
      durationMin: minutes,
      downKbps: plan.downKbps,
      upKbps: plan.upKbps,
    },
  });

  try {
    await authorizeGuest({
      mac,
      minutes,
      downKbps: plan.downKbps,
      upKbps: plan.upKbps,
      bytesQuotaMB: plan.quotaMB,
      apMac: apMac ?? null,
      note: guestClientNote(created.firstName, created.lastName, created.phone),
    });
  } catch (err) {
    await prisma.guestRegistration.delete({ where: { id: created.id } }).catch(() => {});
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Could not grant access: ${message}` }, { status: 502 });
  }

  audit(req, {
    actorType: "guest",
    actor: latest.phone,
    action: "guest.verify_grace",
    target: mac,
    detail: { minutes },
  });

  return NextResponse.json({
    ok: true,
    redirect: cfg.portalSuccessUrl || null,
    magicToken: await createMagicLinkToken(latest.phone),
    grantedMin: minutes,
  });
}
