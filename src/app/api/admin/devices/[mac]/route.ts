import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { getSiteHealth, listControllerEvents, listDevices, listStations } from "@/lib/unifi";
import { collectIssues, groupIssuesByDevice } from "@/lib/issues";
import { deviceNodes } from "@/lib/topology";
import { applyDeviceIgnores } from "@/lib/ignoredDevices";
import { jsonSafe } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_WINDOW_HOURS = 24;

/**
 * One device's topology node + control permissions + live issues, by MAC. Backs
 * the floating device windows (opened from the map, tables, or a path hop), so
 * a window can be opened knowing only a MAC. Reproduces the same node / issue /
 * permission derivation the device pages do.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { session, error } = await requireAdmin(req);
  if (error) return error;

  const mac = decodeURIComponent((await ctx.params).mac).toLowerCase();

  const [allDevices, stations, rawHealth, events] = await Promise.all([
    listDevices(),
    listStations().catch(() => []),
    getSiteHealth().catch(() => []),
    listControllerEvents(EVENT_WINDOW_HOURS).catch(() => []),
  ]);

  const node = deviceNodes(allDevices, stations).find((n) => n.mac.toLowerCase() === mac) ?? null;
  if (!node) return NextResponse.json({ error: "Device not found" }, { status: 404 });

  const { devices: visibleDevices, health } = await applyDeviceIgnores(allDevices, rawHealth);
  const { issues } = collectIssues({ health, devices: visibleDevices, stations, events, eventWindowHours: EVENT_WINDOW_HOURS });
  const issuesForMac = groupIssuesByDevice(issues)[mac] ?? [];

  const canControl = session.role === "admin" || session.sub === "setup";
  const canIgnore = canControl || session.role === "operator";

  return NextResponse.json(jsonSafe({ node, canControl, canIgnore, issues: issuesForMac }));
}
