import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

/** Remove a generator box. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const existing = await prisma.loadTestHost.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.loadTestHost.delete({ where: { id } });
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "loadtest.host.delete",
    target: existing.host,
    detail: { label: existing.label, username: existing.username },
  });
  return NextResponse.json({ ok: true });
}
