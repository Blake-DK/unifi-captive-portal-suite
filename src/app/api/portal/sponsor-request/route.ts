import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guestRegistrationSchema, onlyDigits } from "@/lib/validators";
import { canonicalizeMac } from "@/lib/mac";
import { getMailSettings, isMailConfigured, sendMail } from "@/lib/mailer";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import {
  allowedSponsor,
  createSponsorToken,
  createWatchToken,
  renderSponsorEmail,
  verifyWatchToken,
  SPONSOR_LINK_EXP_MIN,
} from "@/lib/sponsor";
import { resolveLocationForRegistration } from "@/lib/locations";
import { createMagicLinkToken } from "@/lib/guestAuth";
import { getPortalConfig } from "@/lib/config";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sponsored access, request side: the captive form files the validated
 * registration here instead of authorizing directly. The sponsor gets an
 * expiring one-use approval link by email; the guest's browser polls GET
 * with a watch token until the sponsor decides, and the approval path
 * replays the stored payload through the shared registration core.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(`sponsor-request:${clientIp(req) ?? "unknown"}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests — try again later" }, { status: 429 });
  }

  let body: { sponsorEmail?: unknown } & Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const s = await prisma.systemSettings.findUnique({ where: { id: "config" } });
  if (!s?.sponsorRequired) {
    return NextResponse.json({ error: "Sponsored access is not enabled" }, { status: 404 });
  }

  const parsed = guestRegistrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const sponsorEmail = String(body.sponsorEmail ?? "").trim().toLowerCase();
  if (!allowedSponsor(sponsorEmail, { emails: s.sponsorEmails, domains: s.sponsorDomains })) {
    return NextResponse.json(
      { error: "That sponsor address is not on the approved list" },
      { status: 400 },
    );
  }

  const mac = canonicalizeMac(parsed.data.mac);
  if (!mac) return NextResponse.json({ error: "Invalid MAC address" }, { status: 400 });

  // Surface form problems the guest can still fix (building/room rules)
  // BEFORE the sponsor gets bothered.
  const { error: locationError } = await resolveLocationForRegistration(
    parsed.data.locationId,
    parsed.data.building,
    parsed.data.roomNumber,
  );
  if (locationError) return NextResponse.json({ error: locationError }, { status: 400 });

  const mail = await getMailSettings();
  if (!isMailConfigured(mail)) {
    return NextResponse.json(
      { error: "Sponsored access needs email configured — contact staff" },
      { status: 503 },
    );
  }

  const { token, tokenHash } = createSponsorToken();
  const row = await prisma.sponsorRequest.create({
    data: {
      tokenHash,
      expiresAt: new Date(Date.now() + SPONSOR_LINK_EXP_MIN * 60_000),
      sponsorEmail,
      payload: parsed.data as unknown as Prisma.InputJsonValue,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      phone: onlyDigits(parsed.data.phone),
      macAddress: mac,
    },
  });

  const base = (mail.guestBaseUrl || mail.portalBaseUrl || req.nextUrl.origin).replace(/\/$/, "");
  const rendered = renderSponsorEmail({
    brand: mail.brandName || "Guest WiFi",
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    phone: onlyDigits(parsed.data.phone),
    mac,
    locationName: null,
    approveUrl: `${base}/sponsor?token=${encodeURIComponent(token)}`,
  });
  try {
    await sendMail(mail, { to: sponsorEmail, ...rendered, kind: "sponsor" });
  } catch (err) {
    await prisma.sponsorRequest.delete({ where: { id: row.id } }).catch(() => {});
    const message = err instanceof Error ? err.message : "send failed";
    return NextResponse.json(
      { error: `Could not notify the sponsor: ${message}` },
      { status: 502 },
    );
  }

  audit(req, {
    actorType: "guest",
    actor: onlyDigits(parsed.data.phone),
    action: "guest.sponsor_request",
    target: mac,
    detail: { sponsorEmail, requestId: row.id },
  });

  return NextResponse.json({ ok: true, watch: await createWatchToken(row.id) });
}

/** Poll side: the guest's browser asks whether the sponsor has decided. */
export async function GET(req: NextRequest) {
  const watch = req.nextUrl.searchParams.get("watch") ?? "";
  const id = await verifyWatchToken(watch);
  if (!id) return NextResponse.json({ error: "Invalid watch token" }, { status: 400 });

  const row = await prisma.sponsorRequest.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Unknown request" }, { status: 404 });

  if (row.status === "pending" && row.expiresAt.getTime() < Date.now()) {
    await prisma.sponsorRequest
      .updateMany({ where: { id, status: "pending" }, data: { status: "expired" } })
      .catch(() => {});
    return NextResponse.json({ status: "expired" });
  }

  if (row.status !== "approved") return NextResponse.json({ status: row.status });

  const payload = row.payload as { originalUrl?: string | null };
  const cfg = await getPortalConfig();
  return NextResponse.json({
    status: "approved",
    grantedMin: row.grantedMin,
    redirect: cfg.portalSuccessUrl || payload.originalUrl || null,
    magicToken: await createMagicLinkToken(row.phone),
  });
}
