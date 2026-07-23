import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";
import { listControllerEvents, listStations } from "@/lib/unifi";
import { canonicalizeMac } from "@/lib/mac";
import { journeyFromEvents, scoreClient } from "@/lib/clientHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOURNEY_HOURS = 24 * 7;

/** Per-client health score + the client's slice of the controller event log
 * (associations, roams, disconnects) for the last 7 days. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  const mac = canonicalizeMac((await ctx.params).mac);
  if (!mac) return NextResponse.json({ error: "Invalid MAC" }, { status: 400 });

  const [stations, events, watch] = await Promise.all([
    listStations().catch(() => []),
    listControllerEvents(JOURNEY_HOURS, 3000).catch(() => []),
    prisma.watchedClient.findUnique({ where: { mac } }).catch(() => null),
  ]);
  const sta = stations.find((s) => s.mac.toLowerCase() === mac);
  const snr =
    typeof sta?.signal === "number" && typeof sta?.noise === "number"
      ? sta.signal - sta.noise
      : (sta?.rssi ?? null); // classic rssi is already signal-above-noise
  const health = scoreClient({
    connected: Boolean(sta),
    wired: Boolean(sta?.is_wired),
    signalDbm: sta?.signal ?? null,
    snrDb: snr,
  });

  return NextResponse.json({
    health,
    journey: journeyFromEvents(events, mac).slice(0, 100),
    windowHours: JOURNEY_HOURS,
    watched: Boolean(watch && (!watch.expiresAt || watch.expiresAt.getTime() > Date.now())),
  });
}
