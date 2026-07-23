import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { testHost } from "@/lib/loadTest";

export const runtime = "nodejs";

/** SSH to the box with the generated key and confirm docker is runnable. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const row = await prisma.loadTestHost.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await testHost(row);
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "loadtest.host.test",
    target: row.host,
    detail: { ok: result.ok },
  });
  return NextResponse.json(result);
}
