import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { listControllerEvents } from "@/lib/unifi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "What happened at this moment?" — everything the portal knows about a
 * window around one timestamp, so clicking a marker on the assurance timeline
 * tells the whole story in one place instead of sending the operator to three
 * tabs to reassemble it: the alerts that fired or resolved, the controller's
 * own events (link flaps, AP lost contact, WAN transitions), the guest events
 * running at the time, and the admin actions taken.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const at = Number(req.nextUrl.searchParams.get("at"));
  if (!Number.isFinite(at)) {
    return NextResponse.json({ error: "A timestamp is required" }, { status: 400 });
  }
  // Default ±15 min: wide enough to catch the cause and the consequence of a
  // device dropping, tight enough that the list stays readable.
  const windowMin = Math.min(240, Math.max(1, Number(req.nextUrl.searchParams.get("window")) || 15));
  const halfMs = windowMin * 60_000;
  const from = new Date(at - halfMs);
  const to = new Date(at + halfMs);

  const [rawAlerts, audits, guestEvents, ignoredRows] = await Promise.all([
    prisma.alert.findMany({
      where: {
        OR: [
          { firstSeenAt: { gte: from, lte: to } },
          { resolvedAt: { gte: from, lte: to } },
          // Still-open alerts that had already fired before the window.
          { AND: [{ firstSeenAt: { lte: from } }, { resolvedAt: null }] },
        ],
      },
      orderBy: { firstSeenAt: "asc" },
      take: 100,
    }),
    prisma.auditLog.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    prisma.event.findMany({
      where: { startsAt: { lte: to }, endsAt: { gte: from } },
      orderBy: { startsAt: "asc" },
      take: 20,
    }),
    prisma.ignoredDevice.findMany({ select: { mac: true } }).catch(() => []),
  ]);
  // Actively-ignored devices are hidden site-wide, their alert history here
  // included; the ignore lifts (and the history returns) when they come back.
  const ignored = new Set(ignoredRows.map((r) => r.mac));
  const alerts = rawAlerts.filter((a) => !ignored.has(a.target.toLowerCase()));

  // Controller events: the API only takes a "within N hours" window, so ask
  // for enough hours to cover the moment and filter client-side.
  let controllerEvents: { time: number; key: string; msg: string; device: string | null }[] = [];
  let controllerError: string | null = null;
  try {
    const hours = Math.ceil((Date.now() - (at - halfMs)) / 3_600_000) + 1;
    const raw = await listControllerEvents(Math.min(168, Math.max(1, hours)), 1000);
    controllerEvents = raw
      .filter((e) => typeof e.time === "number" && e.time >= from.getTime() && e.time <= to.getTime())
      .map((e) => ({
        time: e.time as number,
        key: e.key ?? "",
        msg: e.msg ?? "",
        device: e.sw_name ?? e.ap_name ?? e.sw ?? e.ap ?? e.gw ?? null,
      }))
      .sort((a, b) => a.time - b.time);
  } catch (err) {
    controllerError = err instanceof Error ? err.message : "Controller events unavailable";
  }

  return NextResponse.json({
    at,
    windowMin,
    from: from.toISOString(),
    to: to.toISOString(),
    alerts: alerts.map((a) => ({
      id: a.id,
      targetName: a.targetName,
      type: a.type,
      severity: a.severity,
      message: a.message,
      value: a.value,
      firstSeenAt: a.firstSeenAt.toISOString(),
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
      // Ongoing at the clicked instant?
      openAtMoment: a.firstSeenAt.getTime() <= at && (!a.resolvedAt || a.resolvedAt.getTime() >= at),
    })),
    controllerEvents,
    controllerError,
    audits: audits.map((a) => ({
      id: a.id,
      at: a.createdAt.toISOString(),
      actor: a.actor,
      action: a.action,
      target: a.target,
      outcome: a.outcome,
    })),
    guestEvents: guestEvents.map((e) => ({
      id: e.id,
      name: e.name,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
    })),
  });
}
