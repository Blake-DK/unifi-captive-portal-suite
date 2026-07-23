import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// No I/O/0/1 — codes get read out loud and typed on phones.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 8;

function generateCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const vouchers = await prisma.voucher.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return NextResponse.json({ vouchers });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const count = Math.min(200, Math.max(1, Math.round(Number(body.count) || 1)));
  const durationMin = Math.round(Number(body.durationMin));
  if (!Number.isFinite(durationMin) || durationMin < 5) {
    return NextResponse.json({ error: "Duration must be at least 5 minutes" }, { status: 400 });
  }
  const maxUses = Math.max(0, Math.round(Number(body.maxUses) || 1));
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 120) || null : null;
  const optionalInt = (v: unknown) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const downKbps = optionalInt(body.downKbps);
  const upKbps = optionalInt(body.upKbps);
  const quotaMB = optionalInt(body.quotaMB);
  let expiresAt: Date | null = null;
  if (body.expiresAt) {
    const d = new Date(body.expiresAt);
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: "Invalid expiry date" }, { status: 400 });
    }
    expiresAt = d;
  }

  const created = [];
  for (let i = 0; i < count; i++) {
    // Retry on the (astronomically unlikely) code collision.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        created.push(
          await prisma.voucher.create({
            data: {
              code: generateCode(),
              note,
              durationMin,
              downKbps,
              upKbps,
              quotaMB,
              maxUses,
              expiresAt,
              createdBy: session.sub,
            },
          }),
        );
        break;
      } catch (err) {
        if (attempt === 2) throw err;
      }
    }
  }

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "voucher.create",
    detail: { count: created.length, durationMin, maxUses, note, expiresAt },
  });

  return NextResponse.json({ vouchers: created });
}
