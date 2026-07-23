import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { jsonSafe } from "@/lib/utils";
import { aggregateSummaries, statusOnHost, type ShardStatus } from "@/lib/loadTest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live status of a run: per-shard container state + summary, aggregated. */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const runId = Number(new URL(req.url).searchParams.get("runId"));
  if (!Number.isInteger(runId)) return NextResponse.json({ error: "Invalid runId" }, { status: 400 });

  const run = await prisma.loadTestRun.findUnique({ where: { id: runId } });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Terminal runs are frozen — return the stored aggregate without touching the boxes.
  if (run.status !== "running") {
    return NextResponse.json(jsonSafe({ run, shards: null, finished: true }));
  }

  const hostIds = (run.hostIds as number[]) ?? [];
  const hosts = await prisma.loadTestHost.findMany({ where: { id: { in: hostIds } } });
  const shards: ShardStatus[] = await Promise.all(
    hostIds.map((id, shard) => {
      const row = hosts.find((h) => h.id === id);
      return row
        ? statusOnHost(row, runId, shard)
        : Promise.resolve<ShardStatus>({ shard, hostId: id, state: "gone", exitCode: null, summary: null });
    }),
  );

  const allTerminal = shards.every((s) => s.state !== "running");
  let out = run;
  if (allTerminal) {
    const anyError = shards.some((s) => s.state === "error");
    const summary = aggregateSummaries(shards.map((s) => s.summary));
    out = await prisma.loadTestRun.update({
      where: { id: runId },
      data: {
        status: anyError ? "error" : "done",
        finishedAt: new Date(),
        summary: summary ? JSON.parse(JSON.stringify(summary)) : undefined,
      },
    });
  }

  return NextResponse.json(jsonSafe({ run: out, shards, finished: allTerminal }));
}
