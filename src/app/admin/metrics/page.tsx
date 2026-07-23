"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ThroughputHistoryChart,
  TimeSeriesChart,
  DeviceResourceChart,
} from "@/components/admin/charts/Charts";
import { wanColor, wanLabel } from "@/lib/wanStyle";

const selectClass =
  "flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm";

const RANGES = [
  { h: 6, label: "6h" },
  { h: 24, label: "24h" },
  { h: 24 * 7, label: "7d" },
  { h: 24 * 30, label: "30d" },
];

type Point = {
  at: string;
  clients: number | null;
  cpuPct: number | null;
  memPct: number | null;
  txRate: number | null;
  rxRate: number | null;
  wanLatency: number | null;
  xputUp: number | null;
  xputDown: number | null;
  devicesUp: number | null;
  devicesDown: number | null;
  guests: number | null;
};

type WanPoint = { at: string; wanLatency: number | null; xputUp: number | null; xputDown: number | null };
type WanSeries = { key: string; name: string; points: WanPoint[] };
type BandSeries = { band: string; points: { at: string; airtimePct: number | null }[] };

const MBPS = (bytesPerSec: number | null) => (bytesPerSec == null ? null : (bytesPerSec * 8) / 1e6);

export default function MetricsPage() {
  const [hours, setHours] = useState(24);
  const [device, setDevice] = useState<string>("");
  const [points, setPoints] = useState<Point[]>([]);
  const [devices, setDevices] = useState<{ mac: string; name: string }[]>([]);
  const [wans, setWans] = useState<WanSeries[]>([]);
  const [bands, setBands] = useState<BandSeries[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const qs = new URLSearchParams({ hours: String(hours) });
    if (device) qs.set("device", device);
    fetch(`/api/admin/metrics?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        setPoints(d.points ?? []);
        if (!device) setDevices(d.devices ?? []); // device list is site-scoped
        setLoading(false);
      })
      .catch(() => live && setLoading(false));
    // Per-WAN series (dual-WAN sites) — site-scoped, so only when not drilled
    // into a single device.
    if (!device) {
      fetch(`/api/admin/metrics?wan=1&hours=${hours}`)
        .then((r) => r.json())
        .then((d) => live && setWans(Array.isArray(d.wans) ? d.wans : []))
        .catch(() => live && setWans([]));
      fetch(`/api/admin/metrics?airtime=1&hours=${hours}`)
        .then((r) => r.json())
        .then((d) => live && setBands(Array.isArray(d.bands) ? d.bands : []))
        .catch(() => live && setBands([]));
    }
    return () => {
      live = false;
    };
  }, [hours, device]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return hours <= 24
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const tp = points.map((p) => ({ t: fmt(p.at), up: MBPS(p.txRate), down: MBPS(p.rxRate) }));
  const clients = points.map((p) => ({ t: fmt(p.at), v: p.clients }));
  const latency = points.map((p) => ({ t: fmt(p.at), v: p.wanLatency }));
  // Speedtest results are already Mbps (no bytes→Mbps conversion) and only
  // present on the periodic speedtest cycles — show the card only if we have any.
  const speedtest = points.map((p) => ({ t: fmt(p.at), up: p.xputUp, down: p.xputDown }));
  const hasSpeedtest = points.some((p) => p.xputDown != null || p.xputUp != null);
  // Per-WAN series (dual-WAN sites) — one card per link, consistent colors.
  const wanCharts = wans.map((w) => ({
    key: w.key,
    name: wanLabel(w.key, w.name),
    color: wanColor(w.key),
    speed: w.points.map((p) => ({ t: fmt(p.at), up: p.xputUp, down: p.xputDown })),
    latency: w.points.map((p) => ({ t: fmt(p.at), v: p.wanLatency })),
    hasSpeed: w.points.some((p) => p.xputDown != null || p.xputUp != null),
  }));
  const multiWan = wanCharts.length >= 2;
  const bandColor: Record<string, string> = { "2.4G": "var(--chart-1)", "5G": "var(--chart-2)", "6G": "var(--chart-4)" };
  const airtimeCharts = bands
    .filter((b) => b.points.some((p) => p.airtimePct != null))
    .map((b) => ({
      band: b.band,
      color: bandColor[b.band] ?? "var(--chart-5)",
      data: b.points.map((p) => ({ t: fmt(p.at), v: p.airtimePct })),
    }));
  const res = points.map((p) => ({ t: fmt(p.at), cpu: p.cpuPct, mem: p.memPct }));
  const devClients = points.map((p) => ({ t: fmt(p.at), v: p.clients }));

  const empty = !loading && points.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Metric history</h1>
          <p className="text-sm text-muted-foreground">
            Trends from the background sampler — WAN throughput, client counts, and per-device
            resource use over time. Enable and tune the interval in Settings → Monitoring → Metric history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className={selectClass} value={device} onChange={(e) => setDevice(e.target.value)}>
            <option value="">Whole site</option>
            {devices.map((d) => (
              <option key={d.mac} value={d.mac}>
                {d.name}
              </option>
            ))}
          </select>
          <div className="flex overflow-hidden rounded-md border">
            {RANGES.map((r) => (
              <button
                key={r.h}
                onClick={() => setHours(r.h)}
                className={`px-3 py-1.5 text-sm ${hours === r.h ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {empty && (
        <Card>
          <CardContent className="space-y-3 py-10 text-center text-sm text-muted-foreground">
            <p>
              No samples yet for this window. Metric history must be enabled, and the sampler then
              writes a point every few minutes.
            </p>
            <a
              href="/admin/settings/monitoring"
              className="inline-block rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              Enable in Settings → Monitoring
            </a>
          </CardContent>
        </Card>
      )}

      {!empty && !device && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">WAN throughput</CardTitle>
              <CardDescription>Current up/down across the sampled window (Mbps).</CardDescription>
            </CardHeader>
            <CardContent>
              <ThroughputHistoryChart data={tp} />
            </CardContent>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Connected clients</CardTitle>
              </CardHeader>
              <CardContent>
                <TimeSeriesChart data={clients} label="Clients" color="var(--chart-2)" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">WAN latency</CardTitle>
              </CardHeader>
              <CardContent>
                <TimeSeriesChart data={latency} label="Latency" color="var(--chart-3)" unit=" ms" />
              </CardContent>
            </Card>
          </div>
          {hasSpeedtest && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Speedtest history</CardTitle>
                <CardDescription>
                  Gateway periodic speedtest — down/up (Mbps). Separates ISP degradation from local
                  network problems (compare against WAN latency above).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ThroughputHistoryChart data={speedtest} />
              </CardContent>
            </Card>
          )}
          {airtimeCharts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Airtime utilization by band</CardTitle>
                <CardDescription>
                  Average channel utilization across access-point radios (%). Sustained high
                  airtime on a band means the spectrum, not the WAN, is the bottleneck.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-3">
                {airtimeCharts.map((a) => (
                  <div key={a.band}>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{a.band}</p>
                    <TimeSeriesChart data={a.data} label="Airtime" color={a.color} unit="%" />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {multiWan && (
            <div className="grid gap-4 lg:grid-cols-2">
              {wanCharts.map((w) => (
                <Card key={w.key}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: w.color }} />
                      {w.name} — speedtest
                    </CardTitle>
                    {!w.hasSpeed && (
                      <CardDescription>
                        This controller doesn&apos;t report a per-interface speedtest for this link —
                        showing latency instead.
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    {w.hasSpeed ? (
                      <ThroughputHistoryChart data={w.speed} />
                    ) : (
                      <TimeSeriesChart data={w.latency} label="Latency" color={w.color} unit=" ms" />
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {!empty && device && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">CPU &amp; memory</CardTitle>
              <CardDescription>{devices.find((d) => d.mac === device)?.name ?? device}</CardDescription>
            </CardHeader>
            <CardContent>
              <DeviceResourceChart data={res} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Associated clients</CardTitle>
            </CardHeader>
            <CardContent>
              <TimeSeriesChart data={devClients} label="Clients" color="var(--chart-2)" />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
