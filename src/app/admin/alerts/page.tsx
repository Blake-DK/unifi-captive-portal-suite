"use client";
import { useEffect, useRef, useState } from "react";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BlockDeviceButton, type BlockInfo } from "@/components/admin/BlockDeviceButton";
import { SortableHead, useTableSort, type SortAccessors } from "@/components/admin/tableSort";
import { ClientLink } from "@/components/admin/ClientWindows";

type Suppressed = {
  id: number;
  ip: string;
  macA: string;
  macB: string;
  vlan: number | null;
  reasons: string[];
  verdict: string;
  firstSeenAt: string;
  lastSeenAt: string;
  count: number;
};

type Alert = {
  id: number;
  target: string;
  targetName: string;
  type: string;
  severity: string;
  message: string;
  value: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
};

// Distinct shapes, not just distinct colors, so severity survives colorblind
// viewing; the aria-label carries it for screen readers.
const sev = (s: string) =>
  s === "error" ? (
    <CircleAlert aria-label="Error" className="h-4 w-4 text-red-600 dark:text-red-400" />
  ) : (
    <TriangleAlert aria-label="Warning" className="h-4 w-4 text-amber-600 dark:text-amber-400" />
  );

function since(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

const OPEN_SORTS: SortAccessors<Alert> = {
  severity: (a) => a.severity,
  target: (a) => a.targetName,
  alert: (a) => a.message,
  since: (a) => a.firstSeenAt,
};
const SUPPRESSED_SORTS: SortAccessors<Suppressed> = {
  ip: (s) => s.ip,
  macs: (s) => [s.macA, s.macB].filter(Boolean).join(" / "),
  vlan: (s) => s.vlan,
  verdict: (s) => s.verdict,
  alarms: (s) => s.count,
  lastSeen: (s) => s.lastSeenAt,
};
const RECENT_SORTS: SortAccessors<Alert> = {
  target: (a) => a.targetName,
  alert: (a) => a.message,
  lasted: (a) =>
    a.resolvedAt ? new Date(a.resolvedAt).getTime() - new Date(a.firstSeenAt).getTime() : null,
  resolved: (a) => a.resolvedAt,
};

export default function AlertsPage() {
  const [open, setOpen] = useState<Alert[]>([]);
  const [recent, setRecent] = useState<Alert[]>([]);
  const [suppressed, setSuppressed] = useState<Suppressed[]>([]);
  const [blocked, setBlocked] = useState<Map<string, BlockInfo>>(new Map());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refreshSec = useRef(15);
  const load = async () => {
    const [alertsRes, blockedRes, suppressedRes] = await Promise.all([
      fetch("/api/admin/alerts"),
      fetch("/api/admin/devices/blocked"),
      fetch("/api/admin/alerts/suppressed"),
    ]);
    if (suppressedRes.ok) {
      const data = await suppressedRes.json();
      setSuppressed(data.suppressed ?? []);
    }
    if (alertsRes.ok) {
      const data = await alertsRes.json();
      setOpen(data.open ?? []);
      setRecent(data.recent ?? []);
      if (data.refreshSec) refreshSec.current = Math.max(3, data.refreshSec);
    }
    if (blockedRes.ok) {
      const data = await blockedRes.json();
      setBlocked(new Map((data.blocked ?? []).map((b: BlockInfo & { mac: string }) => [b.mac.toLowerCase(), b])));
    }
  };
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Reschedule with the configured interval so a settings change takes effect.
    const tick = async () => {
      await load();
      if (live) timer = setTimeout(tick, refreshSec.current * 1000);
    };
    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const runNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/alerts", { method: "POST" });
      const data = await res.json();
      if (data.disabled) setMsg("Alerting is disabled — enable it in Settings → Alerts.");
      else setMsg(`Checked: ${data.stats.open} open (${data.stats.firing} new, ${data.stats.resolved} resolved${data.stats.notified ? ", notified" : ""}).`);
      await load();
    } catch {
      setMsg("Failed to run check");
    } finally {
      setBusy(false);
    }
  };

  const openT = useTableSort(open, OPEN_SORTS);
  const suppressedT = useTableSort(suppressed, SUPPRESSED_SORTS);
  const recentT = useTableSort(recent, RECENT_SORTS);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Alerts</h1>
          <p className="text-sm text-muted-foreground">
            A background monitor opens an alert when a device goes offline/unhealthy, a subsystem
            degrades, CPU/memory crosses your threshold, a switch port saturates or shows
            errors, an admin-login burst comes from one IP (≥5 failures in 15 min), a
            neighbouring AP impersonates one of your SSIDs, a never-before-seen device joins
            (if enabled), a duplicate-IP conflict is confirmed genuine, a WAN link on a
            dual-WAN gateway drops (redundancy lost), or the controller itself stays
            unreachable for several consecutive checks (with an optional SNMPv3 fallback
            sweep of the last-known device list while it's down), and notifies by
            email/webhook on change. Configure it in Settings → Alerts.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={runNow} disabled={busy}>
          {busy ? "Checking…" : "Check now"}
        </Button>
      </div>

      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {open.length === 0 ? "No active alerts" : `${open.length} active alert${open.length !== 1 ? "s" : ""}`}
          </CardTitle>
        </CardHeader>
        {open.length > 0 && (
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="!" k="severity" sort={openT.sort} onToggle={openT.toggle} />
                  <SortableHead label="Device / target" k="target" sort={openT.sort} onToggle={openT.toggle} />
                  <SortableHead label="Alert" k="alert" sort={openT.sort} onToggle={openT.toggle} />
                  <SortableHead label="Since" k="since" sort={openT.sort} onToggle={openT.toggle} />
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {openT.sorted.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{sev(a.severity)}</TableCell>
                    <TableCell className="font-medium">{a.targetName}</TableCell>
                    <TableCell>{a.message}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{since(a.firstSeenAt)}</TableCell>
                    <TableCell className="text-right">
                      {a.type === "rogue_extender" && (
                        <BlockDeviceButton
                          mac={a.target}
                          blocked={blocked.get(a.target.toLowerCase()) ?? null}
                          onDone={load}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>

      {suppressed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Suppressed duplicate-IP alarms</CardTitle>
            <p className="text-sm text-muted-foreground">
              Controller duplicate-IP alarms the suppression gate classified instead of alerting
              on (Settings → Monitoring). Verdict <span className="font-mono">genuine</span> or{" "}
              <span className="font-mono">inconclusive</span> here means dry-run mode logged what
              would have alerted. Nothing is silently dropped — this log is the audit trail.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="IP" k="ip" sort={suppressedT.sort} onToggle={suppressedT.toggle} />
                  <SortableHead label="MACs" k="macs" sort={suppressedT.sort} onToggle={suppressedT.toggle} />
                  <SortableHead label="VLAN" k="vlan" sort={suppressedT.sort} onToggle={suppressedT.toggle} />
                  <SortableHead label="Verdict / reason" k="verdict" sort={suppressedT.sort} onToggle={suppressedT.toggle} />
                  <SortableHead label="Alarms" k="alarms" sort={suppressedT.sort} onToggle={suppressedT.toggle} />
                  <SortableHead label="Last seen" k="lastSeen" sort={suppressedT.sort} onToggle={suppressedT.toggle} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppressedT.sorted.map((sup) => (
                  <TableRow key={sup.id}>
                    <TableCell className="font-mono text-xs">{sup.ip}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {[sup.macA, sup.macB].filter(Boolean).length === 0
                        ? "—"
                        : [sup.macA, sup.macB].filter(Boolean).map((m, i) => (
                            <span key={m}>
                              {i > 0 && " / "}
                              <ClientLink mac={m}>{m}</ClientLink>
                            </span>
                          ))}
                    </TableCell>
                    <TableCell className="text-xs">{sup.vlan ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <span className={sup.verdict !== "suppress" ? "font-medium text-amber-600 dark:text-amber-400" : ""}>{sup.verdict}</span>
                      {" — "}{sup.reasons.join("; ")}
                    </TableCell>
                    <TableCell className="text-xs">{sup.count}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{since(sup.lastSeenAt)} ago</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recently resolved</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Target" k="target" sort={recentT.sort} onToggle={recentT.toggle} />
                <SortableHead label="Alert" k="alert" sort={recentT.sort} onToggle={recentT.toggle} />
                <SortableHead label="Lasted" k="lasted" sort={recentT.sort} onToggle={recentT.toggle} />
                <SortableHead label="Resolved" k="resolved" sort={recentT.sort} onToggle={recentT.toggle} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentT.sorted.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.targetName}</TableCell>
                  <TableCell className="text-muted-foreground">{a.message}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {a.resolvedAt
                      ? `${Math.max(1, Math.round((new Date(a.resolvedAt).getTime() - new Date(a.firstSeenAt).getTime()) / 60000))}m`
                      : ""}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {a.resolvedAt ? `${since(a.resolvedAt)} ago` : ""}
                  </TableCell>
                </TableRow>
              ))}
              {recent.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">No history yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ControllerAlarms />
    </div>
  );
}

type ControllerAlarm = { time: number | null; key: string; msg: string };

/** The controller's own alarm feed (IDS/IPS included) — read-only, loaded on
 * expand so the page doesn't hit the controller unless asked. */
function ControllerAlarms() {
  const [open, setOpen] = useState(false);
  const [alarms, setAlarms] = useState<ControllerAlarm[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || alarms !== null) return;
    let live = true;
    fetch("/api/admin/controller-alarms")
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        if (Array.isArray(d.alarms)) setAlarms(d.alarms);
        else setErr(d.error ?? "Could not load controller alarms.");
      })
      .catch(() => live && setErr("Network error while loading controller alarms."));
    return () => {
      live = false;
    };
  }, [open, alarms]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="hover:text-muted-foreground"
          >
            Controller alarms (IDS/IPS included) {open ? "▾" : "▸"}
          </button>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent>
          {err && <p className="text-sm text-destructive">{err}</p>}
          {!err && alarms === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {alarms !== null && alarms.length === 0 && (
            <p className="text-sm text-muted-foreground">The controller reports no alarms.</p>
          )}
          {alarms !== null && alarms.length > 0 && (
            <ul className="max-h-96 space-y-1 overflow-y-auto text-sm">
              {alarms.map((a, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {a.time ? new Date(a.time).toISOString().slice(0, 16).replace("T", " ") : "—"}
                  </span>
                  <span className="min-w-0">
                    {a.msg || a.key}
                    {a.key && a.msg && (
                      <span className="ml-1 text-xs text-muted-foreground">({a.key})</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      )}
    </Card>
  );
}
