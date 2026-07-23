import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { stopOnHost } from "@/lib/loadTest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Abort a running run: force-remove each shard's container and close the run. */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const runId = Number(body.runId);
  if (!Number.isInteger(runId)) return NextResponse.json({ error: "Invalid runId" }, { status: 400 });

  const run = await prisma.loadTestRun.findUnique({ where: { id: runId } });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const hostIds = (run.hostIds as number[]) ?? [];
  const hosts = await prisma.loadTestHost.findMany({ where: { id: { in: hostIds } } });
  await Promise.all(
    hostIds.map((id, shard) => {
      const row = hosts.find((h) => h.id === id);
      return row ? stopOnHost(row, runId, shard) : Promise.resolve();
    }),
  );

  const updated = await prisma.loadTestRun.update({
    where: { id: runId },
    data: { status: run.status === "running" ? "error" : run.status, finishedAt: run.finishedAt ?? new Date(), note: "stopped by operator" },
  });
  audit(req, { actorType: "admin", actor: session.sub, action: "loadtest.run.stop", detail: { runId } });
  return NextResponse.json({ ok: true, run: updated });
}
