import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { runAlertCycle } from "@/lib/alertMonitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Current open alerts + recently resolved history. Optional `?since=`/`?until=`
 * (ISO timestamps) scope the resolved history to a window instead of the
 * fixed 100-row cap — used by the assurance timeline to match its chart range.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const since = sp.get("since") ? new Date(sp.get("since")!) : null;
  const until = sp.get("until") ? new Date(sp.get("until")!) : null;
  const windowed = Boolean(since || until);

  const resolvedWhere: Record<string, unknown> = { resolvedAt: {} };
  if (since) Object.assign(resolvedWhere.resolvedAt as object, { gte: since });
  if (until) Object.assign(resolvedWhere.resolvedAt as object, { lte: until });
  if (!since && !until) resolvedWhere.resolvedAt = { not: null };

  const [open, recent, cfg, ignoredRows] = await Promise.all([
    prisma.alert.findMany({ where: { resolvedAt: null }, orderBy: [{ severity: "asc" }, { firstSeenAt: "asc" }] }),
    prisma.alert.findMany({
      where: resolvedWhere,
      orderBy: { resolvedAt: "desc" },
      ...(windowed ? {} : { take: 100 }),
    }),
    prisma.systemSettings
      .findUnique({ where: { id: "config" }, select: { liveRefreshSec: true } })
      .catch(() => null),
    prisma.ignoredDevice.findMany({ select: { mac: true } }).catch(() => []),
  ]);
  // A device ignored while offline is hidden everywhere on the site — its
  // alerts (the not-yet-swept open one AND the history rows) included. The
  // ignore auto-clears when the device returns, un-hiding its history. Device
  // alerts carry the MAC as target; other targets never collide with a MAC.
  const ignored = new Set(ignoredRows.map((r) => r.mac));
  const visible = (a: { target: string }) => !ignored.has(a.target.toLowerCase());
  return NextResponse.json({
    open: open.filter(visible),
    recent: recent.filter(visible),
    refreshSec: cfg?.liveRefreshSec ?? 15,
  });
}

/** Force an immediate evaluation cycle (also serves as a "test now" button). */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const stats = await runAlertCycle();
  audit(req, { actorType: "admin", actor: session.sub, action: "alert.run", detail: stats ?? { disabled: true } });
  return NextResponse.json({ stats: stats ?? null, disabled: stats === null });
}
