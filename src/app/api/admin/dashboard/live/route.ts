import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { getSiteHealth, listDevices, listNetworks, listStations } from "@/lib/unifi";
import { applyDeviceIgnores } from "@/lib/ignoredDevices";
import { extractWanLinks } from "@/lib/wan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live network snapshot for the dashboard: WAN status/throughput, clients
 * online, device up/down counts, and open alerts. Polled by the dashboard
 * every few seconds. Controller-unreachable degrades gracefully (network:null)
 * so the tile row still renders the DB-derived alert count.
 *
 * The snapshot is micro-cached in-process (same cache + in-flight-dedup
 * pattern as lib/updateCheck.ts): N open dashboards polling concurrently
 * share one controller fan-out instead of multiplying it. TTL is a few
 * seconds — capped below the poll interval so every poll still sees fresh
 * data, while near-simultaneous viewers coalesce. Auth stays per-request.
 */
const SNAPSHOT_TTL_CAP_MS = 5000;

type ControllerDown = { since: string; summary: string | null } | null;
type Snapshot = { at: string; openAlerts: number; network: unknown; refreshSec: number; controllerDown: ControllerDown };

let cache: { snap: Snapshot; at: number } | null = null;
let inflight: Promise<Snapshot> | null = null;

async function buildSnapshot(): Promise<Snapshot> {
  const openAlerts = await prisma.alert.count({ where: { resolvedAt: null } }).catch(() => 0);
  const refreshSec = await prisma.systemSettings
    .findUnique({ where: { id: "config" }, select: { liveRefreshSec: true } })
    .then((s) => s?.liveRefreshSec ?? 15)
    .catch(() => 15);
  // The controller_down alert row is the cross-process-safe carrier for
  // degraded-mode state (survives a restart, works under the guest/admin
  // split) — the SNMP sweep summary rides its message.
  const controllerDown: ControllerDown = await prisma.alert
    .findFirst({ where: { type: "controller_down", resolvedAt: null }, orderBy: { firstSeenAt: "asc" } })
    .then((a) => (a ? { since: a.firstSeenAt.toISOString(), summary: a.message.split(" — SNMP fallback: ")[1] ?? null } : null))
    .catch(() => null);

  let network: unknown = null;
  try {
    const [allDevices, rawHealth, stations, networks] = await Promise.all([
      listDevices(),
      getSiteHealth(),
      listStations().catch(() => []),
      // Only supplies the friendly WAN names — best-effort.
      listNetworks().catch(() => []),
    ]);
    // Ignored (offline-on-purpose) devices stay out of the tile counts.
    const { devices, health } = await applyDeviceIgnores(allDevices, rawHealth);
    const www = health.find((h) => h.subsystem === "www");
    const wlan = health.find((h) => h.subsystem === "wlan");
    const up = devices.filter((d) => d.state === 1).length;
    const mbps = (v?: number) => (v == null ? null : (v * 8) / 1e6);

    network = {
      wanStatus: www?.status ?? "unknown",
      wanIp: www?.wan_ip ?? null,
      // Per-link state on multi-WAN gateways ([] on single-WAN without data).
      wans: extractWanLinks(devices, www?.wan_ip, networks),
      latency: www?.latency ?? null,
      txMbps: mbps(www?.["tx_bytes-r"]),
      rxMbps: mbps(www?.["rx_bytes-r"]),
      clients: stations.length,
      guests: wlan?.num_guest ?? null,
      devicesUp: up,
      devicesTotal: devices.length,
      aps: devices.filter((d) => d.type === "uap").length,
      switches: devices.filter((d) => d.type === "usw").length,
      // Per-AP client load, busiest first — the dashboard breakdown.
      apBreakdown: devices
        .filter((d) => d.type === "uap")
        .map((d) => ({
          name: d.name || d.mac,
          clients: d.num_sta ?? 0,
          satisfaction: d.satisfaction ?? null,
          online: d.state === 1,
        }))
        .sort((a, b) => b.clients - a.clients),
    };
  } catch {
    network = null;
  }

  return { at: new Date().toISOString(), openAlerts, network, refreshSec, controllerDown };
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const ttl = cache ? Math.min(cache.snap.refreshSec * 1000, SNAPSHOT_TTL_CAP_MS) : 0;
  if (cache && Date.now() - cache.at < ttl) {
    return NextResponse.json(cache.snap);
  }

  inflight ??= buildSnapshot().finally(() => {
    inflight = null;
  });
  const snap = await inflight;
  cache = { snap, at: Date.now() };
  return NextResponse.json(snap);
}
