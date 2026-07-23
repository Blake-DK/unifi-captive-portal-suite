"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Wifi, Server, Gauge, BellRing, Globe, TriangleAlert } from "lucide-react";

type Live = {
  at: string;
  openAlerts: number;
  refreshSec?: number;
  controllerDown: { since: string; summary: string | null } | null;
  network: {
    wanStatus: string;
    wanIp: string | null;
    wans?: { key: string; name: string; up: boolean; enabled: boolean; active: boolean; ip?: string; isp?: string }[];
    latency: number | null;
    txMbps: number | null;
    rxMbps: number | null;
    clients: number;
    guests: number | null;
    devicesUp: number;
    devicesTotal: number;
    aps: number;
    switches: number;
    apBreakdown: { name: string; clients: number; satisfaction: number | null; online: boolean }[];
  } | null;
};

type Accent = "ok" | "warn" | "bad" | "neutral";
const accentClass: Record<Accent, string> = {
  ok: "border-emerald-500/40 bg-emerald-500/5",
  warn: "border-amber-500/40 bg-amber-500/5",
  bad: "border-red-500/40 bg-red-500/5",
  neutral: "",
};
const iconClass: Record<Accent, string> = {
  ok: "text-emerald-600 dark:text-emerald-500",
  warn: "text-amber-600 dark:text-amber-500",
  bad: "text-red-600 dark:text-red-500",
  neutral: "text-muted-foreground",
};

function Tile({
  icon: Icon,
  label,
  value,
  hint,
  accent = "neutral",
  href,
}: {
  icon: typeof Wifi;
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: Accent;
  href?: string;
}) {
  const inner = (
    <div className={`rounded-lg border p-4 transition-colors ${accentClass[accent]} ${href ? "hover:border-primary" : ""}`}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className={`h-4 w-4 ${iconClass[accent]}`} />
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold">{value}</div>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

const fmtMbps = (v: number | null) => (v == null ? "—" : v >= 100 ? Math.round(v).toString() : v.toFixed(1));

export function LiveNetworkStats() {
  const [data, setData] = useState<Live | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Reschedule after each fetch using the server-provided interval, so a
    // change to the setting takes effect on the next tick (no reload).
    const tick = async () => {
      let nextMs = 15_000;
      try {
        const res = await fetch("/api/admin/dashboard/live", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const d = (await res.json()) as Live;
        if (d.refreshSec) nextMs = Math.max(3, d.refreshSec) * 1000;
        if (live) {
          setData(d);
          setStale(false);
        }
      } catch {
        if (live) setStale(true);
      } finally {
        if (live) timer = setTimeout(tick, nextMs);
      }
    };
    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const n = data?.network ?? null;
  const wanOk = n?.wanStatus === "ok";
  // Multi-WAN: a down-but-enabled link degrades the tile to a warning even
  // while the active link keeps the Internet "ok" (redundancy lost).
  const wanLinks = (n?.wans ?? []).filter((w) => w.enabled);
  const multiWan = wanLinks.length >= 2;
  const backupDown = multiWan && wanOk && wanLinks.some((w) => !w.up);
  const wanAccent: Accent = !n ? "neutral" : !wanOk ? "bad" : backupDown ? "warn" : "ok";
  const wanHint = !n
    ? "controller unreachable"
    : multiWan
      ? wanLinks
          .map((w) => `${w.name} ${w.up ? (w.active ? "✓ active" : "✓ standby") : "✕ down"}`)
          .join(" · ")
      : `${n.latency != null ? `${n.latency} ms` : "no latency"}${n.wanIp ? ` · ${n.wanIp}` : ""}`;
  const alertAccent: Accent = (data?.openAlerts ?? 0) > 0 ? "bad" : "ok";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Live network</h2>
        <span className="text-xs text-muted-foreground">
          {stale ? "reconnecting…" : data ? `updated ${new Date(data.at).toLocaleTimeString()}` : "loading…"}
        </span>
      </div>
      {data?.controllerDown && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
          <span>
            Controller unreachable since {new Date(data.controllerDown.since).toLocaleString("en-GB")} —
            monitoring is degraded.{" "}
            {data.controllerDown.summary
              ? `SNMP fallback: ${data.controllerDown.summary}.`
              : "No SNMP fallback configured (Settings → Monitoring)."}
          </span>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Tile
          icon={Globe}
          label="Internet (WAN)"
          value={!n ? "—" : wanOk ? (backupDown ? "Degraded" : "Online") : n.wanStatus}
          hint={wanHint}
          accent={wanAccent}
        />
        <Tile
          icon={Gauge}
          label="WAN throughput"
          value={n ? <span>↓ {fmtMbps(n.rxMbps)} <span className="text-base font-normal text-muted-foreground">/</span> ↑ {fmtMbps(n.txMbps)}</span> : "—"}
          hint="Mbps now"
        />
        <Tile
          icon={Wifi}
          label="Clients online"
          value={n ? n.clients.toLocaleString("en-GB") : "—"}
          hint={n?.guests != null ? `${n.guests} guest${n.guests === 1 ? "" : "s"}` : undefined}
          accent="neutral"
        />
        <Tile
          icon={Server}
          label="Devices up"
          value={n ? `${n.devicesUp}/${n.devicesTotal}` : "—"}
          hint={n ? `${n.aps} APs · ${n.switches} switches` : undefined}
          accent={!n ? "neutral" : n.devicesUp < n.devicesTotal ? "warn" : "ok"}
        />
        <Tile
          icon={data?.openAlerts ? BellRing : Activity}
          label="Open alerts"
          value={data ? data.openAlerts : "—"}
          hint="view alerts"
          accent={data ? alertAccent : "neutral"}
          href="/admin/alerts"
        />
      </div>

      {n && n.apBreakdown.length > 0 && (
        <div className="rounded-lg border p-4">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span className="flex items-center gap-2">
              <Wifi className="h-4 w-4" /> Clients per access point
            </span>
            <Link href="/admin/aps" className="hover:underline">
              all APs
            </Link>
          </div>
          <div className="space-y-1.5">
            {n.apBreakdown.slice(0, 8).map((ap) => {
              const max = Math.max(1, n.apBreakdown[0].clients);
              return (
                <div key={ap.name} className="flex items-center gap-2 text-sm">
                  <span className="w-40 shrink-0 truncate" title={ap.name}>
                    {!ap.online && <span className="text-destructive">○ </span>}
                    {ap.name}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full rounded bg-[var(--chart-1)]/80"
                      style={{ width: `${(ap.clients / max) * 100}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                    {ap.clients}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
