import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

/** Remove a device SSH credential. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const existing = await prisma.deviceSshCredential.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.deviceSshCredential.delete({ where: { id } });
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "device_ssh.delete",
    detail: { username: existing.username, label: existing.label },
  });
  return NextResponse.json({ ok: true });
}
