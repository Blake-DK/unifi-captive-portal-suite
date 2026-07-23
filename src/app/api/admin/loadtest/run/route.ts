import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { launchOnHost, parseWindowSeconds, stopOnHost, type RunParams } from "@/lib/loadTest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start a run: fan the harness out across the selected boxes, one shard per box
 * (shard = index, so identities never collide between boxes). Records a
 * LoadTestRun; per-box container state is polled via the status route.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const hostIds: number[] = Array.isArray(body.hostIds)
    ? body.hostIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n))
    : [];
  const target = typeof body.target === "string" ? body.target.trim() : "";
  if (hostIds.length === 0) return NextResponse.json({ error: "Select at least one generator box" }, { status: 400 });
  if (!/^https?:\/\/.+/i.test(target)) return NextResponse.json({ error: "Target must be an http(s) URL" }, { status: 400 });

  const mode = body.mode === "burst" ? "burst" : "event";
  const params: RunParams = {
    target,
    mode,
    guests: Math.max(1, Math.round(Number(body.guests) || 3000)),
    window: typeof body.window === "string" && body.window.trim() ? body.window.trim() : "10m",
    vus: Math.max(1, Math.round(Number(body.vus) || 150)),
    ramp: typeof body.ramp === "string" && body.ramp.trim() ? body.ramp.trim() : "30s",
    hold: typeof body.hold === "string" && body.hold.trim() ? body.hold.trim() : "60s",
    think: Math.max(0, Number(body.think) || 0),
    site: typeof body.site === "string" && body.site.trim() ? body.site.trim() : "default",
    insecure: body.insecure !== false,
    p95Ms: Math.max(1, Math.round(Number(body.p95Ms) || 2000)),
  };

  const rows = await prisma.loadTestHost.findMany({ where: { id: { in: hostIds } } });
  // Preserve the caller's host order so shard N is stable across run/status.
  const ordered = hostIds.map((id) => rows.find((r) => r.id === id)).filter((r): r is (typeof rows)[number] => Boolean(r));
  if (ordered.length === 0) return NextResponse.json({ error: "No matching hosts" }, { status: 400 });

  const run = await prisma.loadTestRun.create({
    data: {
      status: "running",
      mode,
      guests: params.guests,
      windowSec: mode === "event" ? parseWindowSeconds(params.window) : parseWindowSeconds(params.ramp) + parseWindowSeconds(params.hold) + 10,
      target,
      hostIds: ordered.map((r) => r.id),
    },
  });

  const launched: { hostId: number; shard: number; container?: string; error?: string }[] = [];
  for (let shard = 0; shard < ordered.length; shard++) {
    const row = ordered[shard];
    try {
      const container = await launchOnHost(row, run.id, shard, params);
      launched.push({ hostId: row.id, shard, container });
    } catch (err) {
      launched.push({ hostId: row.id, shard, error: err instanceof Error ? err.message : "launch failed" });
    }
  }

  const okCount = launched.filter((l) => l.container).length;
  if (okCount === 0) {
    // Nothing started — tear down and fail the run.
    await Promise.all(ordered.map((r, shard) => stopOnHost(r, run.id, shard)));
    await prisma.loadTestRun.update({ where: { id: run.id }, data: { status: "error", finishedAt: new Date(), note: "no shard launched" } });
    audit(req, { actorType: "admin", actor: session.sub, action: "loadtest.run.start", target, detail: { runId: run.id, ok: 0, hosts: ordered.length } });
    return NextResponse.json({ error: "No shard could be launched", launched }, { status: 502 });
  }

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "loadtest.run.start",
    target,
    detail: { runId: run.id, mode, guests: params.guests, window: params.window, hosts: ordered.length, launched: okCount },
  });
  return NextResponse.json({ ok: true, runId: run.id, launched });
}
