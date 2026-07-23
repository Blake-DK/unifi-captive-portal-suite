import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashSponsorToken } from "@/lib/sponsor";
import { registerGuest, RegistrationError } from "@/lib/registerGuest";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { auditSystem } from "@/lib/audit";
import type { GuestRegistrationInput } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The sponsor's decision. The emailed token is the credential (one use;
 * expires an hour after issue). Approval replays the stored registration
 * payload through the shared core with the sponsor's grant as the duration
 * — so the guest's MAC is authorized on the controller the moment the
 * sponsor clicks, with the sponsor's identity in the audit trail.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(`sponsor-decide:${clientIp(req) ?? "unknown"}`, 20, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  let body: { token?: unknown; action?: unknown; minutes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const token = String(body.token ?? "");
  const action = body.action === "approve" ? "approve" : body.action === "deny" ? "deny" : null;
  if (!token || !action) {
    return NextResponse.json({ error: "token and action are required" }, { status: 400 });
  }

  const row = await prisma.sponsorRequest.findUnique({
    where: { tokenHash: hashSponsorToken(token) },
  });
  if (!row) return NextResponse.json({ error: "Unknown or already-used link" }, { status: 404 });

  if (row.status === "pending" && row.expiresAt.getTime() < Date.now()) {
    await prisma.sponsorRequest
      .updateMany({ where: { id: row.id, status: "pending" }, data: { status: "expired" } })
      .catch(() => {});
    return NextResponse.json({ error: "This request has expired" }, { status: 410 });
  }
  if (row.status !== "pending") {
    return NextResponse.json(
      { error: `This request was already ${row.status}` },
      { status: 409 },
    );
  }

  // One-use claim: two sponsors clicking concurrently must not both decide.
  const claimed = await prisma.sponsorRequest.updateMany({
    where: { id: row.id, status: "pending" },
    data: { status: "deciding" },
  });
  if (claimed.count !== 1) {
    return NextResponse.json({ error: "This request was already decided" }, { status: 409 });
  }

  if (action === "deny") {
    await prisma.sponsorRequest.update({
      where: { id: row.id },
      data: { status: "denied", decidedAt: new Date() },
    });
    await auditSystem({
      actorType: "system",
      actor: row.sponsorEmail,
      action: "guest.sponsor_deny",
      target: row.macAddress,
      detail: { requestId: row.id, phone: row.phone },
    });
    return NextResponse.json({ ok: true, status: "denied" });
  }

  const s = await prisma.systemSettings.findUnique({ where: { id: "config" } });
  const requested = Math.round(Number(body.minutes));
  const minutes =
    s?.sponsorDurationOverride && Number.isFinite(requested) && requested > 0
      ? Math.min(requested, 60 * 24 * 30) // cap a month
      : (s?.sponsorDefaultMin ?? 1440);

  let result;
  try {
    result = await registerGuest(
      row.payload as unknown as GuestRegistrationInput,
      { origin: req.nextUrl.origin },
      { minutesOverride: minutes },
    );
  } catch (err) {
    // Registration failed (device cap, controller down…): hand the request
    // back so the sponsor can retry once the guest fixes their side.
    await prisma.sponsorRequest
      .updateMany({ where: { id: row.id, status: "deciding" }, data: { status: "pending" } })
      .catch(() => {});
    const message = err instanceof RegistrationError ? err.message : "Registration failed";
    const status = err instanceof RegistrationError ? err.status : 500;
    if (!(err instanceof RegistrationError)) console.error("Sponsor approval failed:", err);
    return NextResponse.json({ error: message }, { status });
  }

  await prisma.sponsorRequest.update({
    where: { id: row.id },
    data: {
      status: "approved",
      decidedAt: new Date(),
      grantedMin: minutes,
      registrationId: result.id,
    },
  });
  await auditSystem({
    actorType: "system",
    actor: row.sponsorEmail,
    action: "guest.sponsor_approve",
    target: row.macAddress,
    detail: { requestId: row.id, phone: row.phone, grantedMin: minutes, registrationId: result.id },
  });
  return NextResponse.json({ ok: true, status: "approved", grantedMin: minutes });
}
