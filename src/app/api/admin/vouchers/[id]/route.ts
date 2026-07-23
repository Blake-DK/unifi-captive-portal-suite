import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Revoke a voucher: it can no longer be redeemed (existing access stays). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid voucher id" }, { status: 400 });
  }

  const voucher = await prisma.voucher.findUnique({ where: { id } });
  if (!voucher) return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
  if (!voucher.revokedAt) {
    await prisma.voucher.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "voucher.revoke",
    target: String(id),
    detail: { note: voucher.note, usedCount: voucher.usedCount },
  });

  return NextResponse.json({ ok: true });
}
