import { prisma } from "./prisma";
import { getSiteHealth, listDevices, listNetworks } from "./unifi";
import { applyDeviceIgnores } from "./ignoredDevices";
import { extractWanLinks } from "./wan";

/**
 * Metric history sampler. Each cycle takes ONE controller snapshot and writes:
 *   - one site-level row (throughput, clients, WAN latency/speedtest, up/down)
 *   - one row per online device (CPU, memory, client count), when enabled
 * then prunes rows older than the retention window. A single bulk createMany +
 * one deleteMany per cycle keeps write volume bounded even on a large fleet;
 * the interval is coarse (default 5 min) and configurable. Single-container
 * timer, like the alert/expiry/retention schedulers.
 */

export type MetricRunStats = { site: boolean; devices: number; pruned: number; skipped?: string };

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function runMetricCycle(): Promise<MetricRunStats | null> {
  const s = await prisma.systemSettings.findUnique({ where: { id: "config" } });
  if (!s?.metricsEnabled) return null;

  let devices, health, networks;
  try {
    [devices, health, networks] = await Promise.all([
      listDevices(),
      getSiteHealth().catch(() => []),
      listNetworks().catch(() => []),
    ]);
  } catch {
    return { site: false, devices: 0, pruned: 0, skipped: "controller unreachable" };
  }
  // Ignored (offline-on-purpose) devices stay out of the recorded history —
  // devicesDown would otherwise chart a permanent plateau per ignored device.
  ({ devices, health } = await applyDeviceIgnores(devices, health));

  const at = new Date();
  const www = health.find((h) => h.subsystem === "www");
  const wlan = health.find((h) => h.subsystem === "wlan");
  const up = devices.filter((d) => d.state === 1);
  const clients = up.reduce((sum, d) => sum + (Number(d.num_sta) || 0), 0);

  // Per-WAN links (dual-WAN gateways). The site row's speedtest reflects the
  // ACTIVE uplink only, so tag it with that WAN, and write a row per link so
  // a backup WAN's history is captured even while the primary carries traffic.
  const wanLinks = extractWanLinks(devices, www?.wan_ip, networks);
  const activeWan = wanLinks.find((w) => w.active);

  const rows: Array<Record<string, unknown>> = [
    {
      at,
      scope: "site",
      wanKey: activeWan?.key ?? null,
      clients,
      txRate: num(www?.["tx_bytes-r"]),
      rxRate: num(www?.["rx_bytes-r"]),
      wanLatency: www?.latency != null ? Math.round(www.latency) : null,
      xputUp: num(www?.xput_up),
      xputDown: num(www?.xput_down),
      devicesUp: up.length,
      devicesDown: devices.length - up.length,
      guests: wlan?.num_guest != null ? wlan.num_guest : null,
    },
  ];

  // One row per WAN link when the gateway is multi-WAN (a single link is
  // already covered by the site row above). Speed fields are null when the
  // controller doesn't report per-interface speedtest — the row still records
  // latency/availability and which link was up.
  if (wanLinks.length >= 2) {
    for (const w of wanLinks) {
      rows.push({
        at,
        scope: "wan",
        wanKey: w.key,
        name: w.name,
        wanLatency: w.latencyAvg != null ? Math.round(w.latencyAvg) : null,
        xputUp: w.xputUp ?? null,
        xputDown: w.xputDown ?? null,
      });
    }
  }

  if (s.metricPerDevice) {
    for (const d of up) {
      const ss = d["system-stats"] ?? {};
      rows.push({
        at,
        scope: "device",
        deviceMac: d.mac,
        name: d.name || d.mac,
        clients: Number(d.num_sta) || 0,
        cpuPct: num(ss.cpu),
        memPct: num(ss.mem),
      });
      // One row per AP radio: channel utilization history (airtime) and the
      // clients on that band — the data behind the metrics page's airtime
      // charts (unpoller charts the same fields).
      for (const r of d.radio_table_stats ?? []) {
        if (r.cu_total === undefined) continue;
        const band = r.radio === "ng" ? "2.4G" : r.radio === "na" ? "5G" : r.radio === "6e" ? "6G" : r.radio ?? "?";
        rows.push({
          at,
          scope: "radio",
          deviceMac: d.mac,
          name: d.name || d.mac,
          band,
          airtimePct: Math.round(Number(r.cu_total) || 0),
          clients: Number(r.num_sta) || 0,
        });
      }
    }
  }

  await prisma.metricSample.createMany({ data: rows as never });

  const cutoff = new Date(Date.now() - Math.max(1, s.metricRetentionDays) * 24 * 60 * 60 * 1000);
  const pruned = await prisma.metricSample.deleteMany({ where: { at: { lt: cutoff } } });

  const deviceRows = rows.filter((r) => r.scope === "device").length;
  return { site: true, devices: deviceRows, pruned: pruned.count };
}

let started = false;
const FIRST_DELAY_MS = 60_000;

/** Start the in-process metric sampler (single-container deploy). */
export function startMetricSampler(): void {
  if (started) return;
  started = true;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    let intervalSec = 300;
    try {
      const s = await prisma.systemSettings.findUnique({
        where: { id: "config" },
        select: { metricSampleSec: true, metricsEnabled: true },
      });
      intervalSec = Math.max(60, s?.metricSampleSec || 300);
      if (s?.metricsEnabled) await runMetricCycle();
    } catch (err) {
      console.error("Metric sample cycle failed:", err);
    } finally {
      timer = setTimeout(tick, intervalSec * 1000);
      timer.unref?.();
    }
  };

  timer = setTimeout(tick, FIRST_DELAY_MS);
  timer.unref?.();
  console.log("Metric sampler started.");
}
