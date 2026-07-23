import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";
import { canonicalizeMac } from "@/lib/mac";
import { detectExtender } from "@/lib/rogueExtenders";
import { getBlockedDevicesMap } from "@/lib/blockedDevices";
import { getClientSessions, getNameMaps, listStations, type UniFiStation } from "@/lib/unifi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_WINDOW_DAYS = 30;

/**
 * Everything the portal knows about one client MAC, for the client detail
 * window: live controller state, extender/blocked flags, the full local
 * registration history, and the controller's connection-session history.
 * Read-only, so any admin role (including monitor) may call it. Controller
 * outages degrade gracefully: DB-backed sections still return.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const { mac: rawMac } = await ctx.params;
  const mac = canonicalizeMac(decodeURIComponent(rawMac));
  if (!mac) return NextResponse.json({ error: "Invalid MAC address" }, { status: 400 });

  let live: UniFiStation | null = null;
  let controllerError: string | null = null;
  let deviceName = new Map<string, string>();
  let networkNameById = new Map<string, string>();
  let sessions: Awaited<ReturnType<typeof getClientSessions>> = [];

  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const [stations, maps, sessionRows] = await Promise.all([
      listStations(),
      getNameMaps(),
      getClientSessions(mac, nowSec - SESSION_WINDOW_DAYS * 86_400, nowSec).catch(() => []),
    ]);
    live = stations.find((s) => s.mac.toLowerCase() === mac) ?? null;
    deviceName = maps.deviceName;
    networkNameById = maps.networkNameById;
    sessions = sessionRows;
  } catch (err) {
    controllerError = err instanceof Error ? err.message : "Error querying UniFi";
  }

  const registrations = await prisma.guestRegistration.findMany({
    where: { macAddress: mac },
    orderBy: { authorizedAt: "desc" },
    take: 100,
  });
  const blocked = (await getBlockedDevicesMap()).get(mac) ?? null;
  // Only the controller's own hostname/alias feeds detection — never a
  // guest-chosen device label, which would mint HIGH-confidence extender flags
  // from user-supplied text that /admin/clients (live stations only) never sees.
  const extender = detectExtender({ mac, hostname: live?.hostname, name: live?.name });

  const resolveDevice = (devMac?: string) =>
    devMac ? (deviceName.get(devMac.toLowerCase()) ?? devMac) : null;

  return NextResponse.json({
    mac,
    controllerError,
    live: live
      ? {
          hostname: live.name ?? live.hostname ?? null,
          ip: live.ip ?? null,
          wired: Boolean(live.is_wired),
          essid: live.essid ?? null,
          rssi: live.rssi ?? null,
          vlan: live.vlan ?? null,
          network:
            (live.network_id ? networkNameById.get(live.network_id) : undefined) ??
            live.network ??
            null,
          uplink: live.is_wired
            ? `${resolveDevice(live.sw_mac) ?? "?"}${live.sw_port != null ? ` port ${live.sw_port}` : ""}`
            : resolveDevice(live.ap_mac),
          rxBytes: live.rx_bytes ?? 0,
          txBytes: live.tx_bytes ?? 0,
        }
      : null,
    extender: extender
      ? { confidence: extender.confidence, reason: extender.reason, vendor: extender.vendor }
      : null,
    blocked: blocked
      ? { reason: blocked.reason, blockedBy: blocked.blockedBy, blockedAt: blocked.blockedAt }
      : null,
    registrations: registrations.map((r) => ({
      id: r.id,
      name: `${r.firstName} ${r.lastName}`,
      phone: r.phone,
      email: r.email,
      location: r.locationName ?? r.baseLocation,
      building: r.building,
      room: r.roomNumber,
      ssid: r.ssid,
      label: r.label,
      authorizedAt: r.authorizedAt,
      durationMin: r.durationMin,
      revokedAt: r.revokedAt,
      lastSeenAt: r.lastSeenAt,
      anonymized: r.anonymizedAt != null,
    })),
    sessions: sessions
      .sort((a, b) => (b.assoc_time ?? 0) - (a.assoc_time ?? 0))
      .slice(0, 200)
      .map((s) => ({
        start: s.assoc_time ?? null,
        durationSec: s.duration ?? null,
        ap: resolveDevice(s.ap_mac),
        ip: s.ip ?? null,
        rxBytes: s.rx_bytes ?? 0,
        txBytes: s.tx_bytes ?? 0,
      })),
  });
}
