import { prisma } from "@/lib/prisma";
import { StatCard } from "@/components/admin/StatCard";
import { LiveNetworkStats } from "@/components/admin/LiveNetworkStats";
import { RetentionNudge } from "@/components/admin/RetentionNudge";
import { HealthScoreCard } from "@/components/admin/HealthScoreCard";
import { scoreNetworkHealth } from "@/lib/healthScore";
import { applyDeviceIgnores } from "@/lib/ignoredDevices";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ConnectionsLineChart,
  PeakHoursPieChart,
  RetentionBarChart,
  SiteTrafficChart,
  WirelessClientsChart,
} from "@/components/admin/charts/Charts";
import { getDailySiteStats, getDpiTraffic, getSiteHealth, listDevices } from "@/lib/unifi";
import { dpiAppName } from "@/lib/dpiCatalog";

/** Roll up open alerts + controller health into the dashboard health score. */
async function loadHealthScore() {
  const openAlerts = await prisma.alert.findMany({
    where: { resolvedAt: null },
    select: { severity: true },
  });
  const errorAlerts = openAlerts.filter((a) => a.severity === "error").length;
  const warningAlerts = openAlerts.length - errorAlerts;

  let offlineDevices = 0;
  let badSubsystems = 0;
  try {
    const [allDevices, rawHealth] = await Promise.all([listDevices(), getSiteHealth().catch(() => [])]);
    // Ignored (offline-on-purpose) devices don't drag the score down.
    const { devices, health } = await applyDeviceIgnores(allDevices, rawHealth);
    offlineDevices = devices.filter((d) => d.state !== 1).length;
    badSubsystems = health.filter(
      (h) => h.status && h.status !== "ok" && h.status !== "unknown",
    ).length;
  } catch {
    /* controller unreachable — score from alerts alone */
  }

  const result = scoreNetworkHealth({ errorAlerts, warningAlerts, offlineDevices, badSubsystems });
  const factors = [
    errorAlerts > 0 ? `${errorAlerts} error alert${errorAlerts !== 1 ? "s" : ""}` : "",
    warningAlerts > 0 ? `${warningAlerts} warning${warningAlerts !== 1 ? "s" : ""}` : "",
    offlineDevices > 0 ? `${offlineDevices} device${offlineDevices !== 1 ? "s" : ""} offline` : "",
    badSubsystems > 0 ? `${badSubsystems} subsystem${badSubsystems !== 1 ? "s" : ""} unhealthy` : "",
  ].filter(Boolean);
  return { ...result, factors };
}

export const dynamic = "force-dynamic";

/** Top talkers over the last 24h, from per-client DPI. Null when DPI is off
 * or the controller is unreachable — the card simply doesn't render. */
async function loadTopTalkers(): Promise<{
  clients: { name: string; mac: string; gb: number }[];
  apps: { app: string; gb: number }[];
} | null> {
  try {
    const end = Date.now();
    const dpi = await getDpiTraffic(end - 86_400_000, end);
    if (dpi.length === 0) return null;
    const gb = (b: number) => b / 1024 ** 3;
    const appTotals = new Map<string, number>();
    const clients = dpi
      .map((c) => {
        const bytes = c.usage_by_app.reduce((n, u) => {
          const b = u.total_bytes ?? (u.bytes_received ?? 0) + (u.bytes_transmitted ?? 0);
          const label = dpiAppName(u.category, u.application);
          appTotals.set(label, (appTotals.get(label) ?? 0) + b);
          return n + b;
        }, 0);
        return { name: c.client.name || c.client.hostname || c.client.mac, mac: c.client.mac, gb: gb(bytes) };
      })
      .sort((a, b) => b.gb - a.gb)
      .slice(0, 5);
    const apps = [...appTotals.entries()]
      .map(([app, bytes]) => ({ app, gb: gb(bytes) }))
      .sort((a, b) => b.gb - a.gb)
      .slice(0, 5);
    return { clients, apps };
  } catch {
    return null;
  }
}

async function loadStats() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const last30 = new Date();
  last30.setDate(last30.getDate() - 29);
  last30.setHours(0, 0, 0, 0);

  const [total, todayCount, distinctMacs, recent] = await Promise.all([
    prisma.guestRegistration.count(),
    prisma.guestRegistration.count({ where: { authorizedAt: { gte: startOfToday } } }),
    prisma.guestRegistration
      .findMany({ select: { macAddress: true }, distinct: ["macAddress"] })
      .then((r) => r.length),
    prisma.guestRegistration.findMany({
      where: { authorizedAt: { gte: last30 } },
      select: { authorizedAt: true, macAddress: true },
      orderBy: { authorizedAt: "asc" },
    }),
  ]);

  // Daily series
  const dayMap = new Map<string, number>();
  for (let i = 0; i < 30; i++) {
    const d = new Date(last30);
    d.setDate(last30.getDate() + i);
    dayMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const r of recent) {
    const k = r.authorizedAt.toISOString().slice(0, 10);
    if (dayMap.has(k)) dayMap.set(k, (dayMap.get(k) ?? 0) + 1);
  }
  const lineData = Array.from(dayMap, ([date, count]) => ({
    date: date.slice(5),
    count,
  }));

  // Peak hours (4-hour buckets)
  const buckets = [
    { label: "00–04h", value: 0 },
    { label: "04–08h", value: 0 },
    { label: "08–12h", value: 0 },
    { label: "12–16h", value: 0 },
    { label: "16–20h", value: 0 },
    { label: "20–24h", value: 0 },
  ];
  for (const r of recent) {
    const h = r.authorizedAt.getHours();
    buckets[Math.floor(h / 4)].value++;
  }

  // Retention: new vs returning over last 4 weekly periods
  const seenMacs = new Set<string>();
  const allBefore = await prisma.guestRegistration.findMany({
    where: { authorizedAt: { lt: last30 } },
    select: { macAddress: true },
  });
  allBefore.forEach((r) => seenMacs.add(r.macAddress));

  const weeks: { period: string; newGuests: number; returning: number }[] = [];
  for (let w = 3; w >= 0; w--) {
    const ws = new Date();
    ws.setDate(ws.getDate() - (w + 1) * 7);
    ws.setHours(0, 0, 0, 0);
    const we = new Date(ws);
    we.setDate(ws.getDate() + 7);
    const period = `${ws.getDate()}/${ws.getMonth() + 1}`;
    const wEntries = recent.filter((r) => r.authorizedAt >= ws && r.authorizedAt < we);
    let newGuests = 0;
    let returning = 0;
    for (const e of wEntries) {
      if (seenMacs.has(e.macAddress)) returning++;
      else {
        newGuests++;
        seenMacs.add(e.macAddress);
      }
    }
    weeks.push({ period, newGuests, returning });
  }

  return { total, todayCount, distinctMacs, lineData, buckets, weeks };
}

/** Last-30-days WLAN traffic + client counts from the controller's report store. */
async function loadSiteStats(): Promise<{
  traffic: { date: string; gb: number }[];
  clients: { date: string; clients: number }[];
} | null> {
  try {
    const end = Date.now();
    const start = end - 30 * 86_400_000;
    const rows = await getDailySiteStats(start, end);
    if (rows.length === 0) return null;
    const traffic = rows.map((r) => ({
      date: new Date(r.time).toISOString().slice(5, 10),
      gb: r.wlanBytes / 1024 ** 3,
    }));
    const clients = rows.map((r) => ({
      date: new Date(r.time).toISOString().slice(5, 10),
      clients: r.wlanClients,
    }));
    return { traffic, clients };
  } catch {
    return null; // UniFi unreachable — dashboard renders without these charts
  }
}

export default async function AdminDashboard() {
  const [{ total, todayCount, distinctMacs, lineData, buckets, weeks }, siteStats, health, talkers] =
    await Promise.all([loadStats(), loadSiteStats(), loadHealthScore(), loadTopTalkers()]);

  // Retention nudge: still "keep forever" both for the global default and every
  // location = no finite retention set. Show the reminder until one is chosen.
  const [cfg, locations] = await Promise.all([
    prisma.systemSettings.findUnique({
      where: { id: "config" },
      select: { defaultRetentionMode: true },
    }),
    prisma.location.findMany({ select: { retentionMode: true } }),
  ]);
  const retentionUnset =
    (cfg?.defaultRetentionMode ?? "forever") === "forever" &&
    locations.every((l) => l.retentionMode === "forever");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Live network status and guest portal analytics</p>
      </div>

      {retentionUnset && <RetentionNudge />}

      <HealthScoreCard score={health.score} band={health.band} label={health.label} factors={health.factors} />

      <LiveNetworkStats />

      {talkers && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top talkers — last 24h</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {talkers.clients.map((c) => (
                  <li key={c.mac} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{c.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {c.gb >= 0.1 ? `${c.gb.toFixed(1)} GB` : `${Math.round(c.gb * 1024)} MB`}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top applications — last 24h</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {talkers.apps.map((a) => (
                  <li key={a.app} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{a.app}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {a.gb >= 0.1 ? `${a.gb.toFixed(1)} GB` : `${Math.round(a.gb * 1024)} MB`}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Guests</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard title="Total Connections" value={total.toLocaleString("en-GB")} hint="all time" />
          <StatCard title="Unique Visitors" value={distinctMacs.toLocaleString("en-GB")} hint="distinct devices" />
          <StatCard title="Connections Today" value={todayCount.toLocaleString("en-GB")} hint="since midnight" />
        </div>
      </div>

      {siteStats && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">WiFi Traffic (GB/day) — last 30 days</CardTitle>
            </CardHeader>
            <CardContent>
              <SiteTrafficChart data={siteStats.traffic} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Wireless Clients — last 30 days</CardTitle>
            </CardHeader>
            <CardContent>
              <WirelessClientsChart data={siteStats.clients} />
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connections — last 30 days</CardTitle>
          </CardHeader>
          <CardContent>
            <ConnectionsLineChart data={lineData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Peak Hours</CardTitle>
          </CardHeader>
          <CardContent>
            <PeakHoursPieChart data={buckets} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Retention (new vs returning)</CardTitle>
          </CardHeader>
          <CardContent>
            <RetentionBarChart data={weeks} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
