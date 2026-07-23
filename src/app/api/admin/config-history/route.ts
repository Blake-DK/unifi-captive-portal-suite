import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { runConfigWatchCycle } from "@/lib/configHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Snapshot list for the Config history page (newest first, no bundles). */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;
  const rows = await prisma.configSnapshot.findMany({
    orderBy: { id: "desc" },
    take: 100,
    select: { id: true, takenAt: true, hash: true, summary: true },
  });
  return NextResponse.json({ snapshots: rows });
}

/** Take a snapshot right now (works even while the hourly watch is off). */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;
  const stats = await runConfigWatchCycle({ force: true });
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "controller.config_snapshot",
    detail: { changed: stats.changed, baseline: stats.baseline ?? false, skipped: stats.skipped ?? null },
  });
  return NextResponse.json(stats);
}
