import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cap points returned to the chart; longer windows get bucket-averaged so the
// payload stays small no matter the retention depth.
const MAX_POINTS = 300;

type Row = Awaited<ReturnType<typeof prisma.metricSample.findMany>>[number];

/** Average numeric fields across a bucket of rows, keeping the bucket's mid time. */
function bucket(rows: Row[], target: number): Row[] {
  if (rows.length <= target) return rows;
  const size = Math.ceil(rows.length / target);
  const out: Row[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const group = rows.slice(i, i + size);
    const mid = group[Math.floor(group.length / 2)];
    const avg = (key: keyof Row) => {
      const vals = group.map((r) => r[key]).filter((v): v is number => typeof v === "number");
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    out.push({
      ...mid,
      clients: avg("clients") as number | null,
      cpuPct: avg("cpuPct") as number | null,
      memPct: avg("memPct") as number | null,
      txRate: avg("txRate") as number | null,
      rxRate: avg("rxRate") as number | null,
      wanLatency: avg("wanLatency") as number | null,
      xputUp: avg("xputUp") as number | null,
      xputDown: avg("xputDown") as number | null,
      devicesUp: avg("devicesUp") as number | null,
      devicesDown: avg("devicesDown") as number | null,
      guests: avg("guests") as number | null,
      airtimePct: avg("airtimePct") as number | null,
    });
  }
  return out;
}

/**
 * Metric time-series for the charts. `?scope=site` (default) or
 * `?device=<mac>` for a single device, `?hours=<n>` window (default 24).
 * Also returns the list of devices that have samples so the UI can offer a picker.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const hours = Math.min(24 * 30, Math.max(1, Number(sp.get("hours")) || 24));
  const device = sp.get("device");
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // Per-WAN series: one bucketed point-set per WAN link (grouped by wanKey),
  // so the speedtest/latency charts can draw a line per WAN.
  if (sp.get("wan")) {
    const rows = await prisma.metricSample.findMany({
      where: { scope: "wan", at: { gte: since } },
      orderBy: { at: "asc" },
    });
    const byKey = new Map<string, { key: string; name: string; rows: Row[] }>();
    for (const r of rows) {
      const k = r.wanKey ?? "?";
      if (!byKey.has(k)) byKey.set(k, { key: k, name: r.name ?? k, rows: [] });
      const g = byKey.get(k)!;
      // Rows are at-ascending: keep the newest label, so a renamed WAN (e.g.
      // port label → friendly name) doesn't wear its stale name all window.
      if (r.name) g.name = r.name;
      g.rows.push(r);
    }
    const wans = [...byKey.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((g) => ({ key: g.key, name: g.name, points: bucket(g.rows, MAX_POINTS) }));
    return NextResponse.json({ hours, scope: "wan", wans });
  }

  // Airtime per band: average channel utilization across AP radios, one line
  // per band (2.4G/5G/6G).
  if (sp.get("airtime")) {
    const rows = await prisma.metricSample.findMany({
      where: { scope: "radio", at: { gte: since } },
      orderBy: { at: "asc" },
    });
    const byBand = new Map<string, Row[]>();
    for (const r of rows) {
      const band = r.band ?? "?";
      if (!byBand.has(band)) byBand.set(band, []);
      byBand.get(band)!.push(r);
    }
    const bands = [...byBand.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([band, br]) => ({ band, points: bucket(br, MAX_POINTS) }));
    return NextResponse.json({ hours, scope: "airtime", bands });
  }

  const where =
    device
      ? { scope: "device", deviceMac: device, at: { gte: since } }
      : { scope: "site", at: { gte: since } };

  const [rows, deviceList] = await Promise.all([
    prisma.metricSample.findMany({ where, orderBy: { at: "asc" } }),
    // Distinct devices seen in the retained window, for the picker.
    prisma.metricSample.findMany({
      where: { scope: "device", at: { gte: since } },
      distinct: ["deviceMac"],
      select: { deviceMac: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return NextResponse.json({
    hours,
    scope: device ? "device" : "site",
    device: device ?? null,
    points: bucket(rows, MAX_POINTS),
    devices: deviceList.map((d) => ({ mac: d.deviceMac, name: d.name })),
  });
}
