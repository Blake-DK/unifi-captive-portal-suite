"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeSeriesChart } from "@/components/admin/charts/Charts";
import { AssuranceTimelineStrip, type TimelineAlert, type TimelineEvent } from "@/components/admin/AssuranceTimelineStrip";
import { TimelineMomentDialog } from "@/components/admin/TimelineMomentDialog";

const RANGES = [
  { h: 6, label: "6h" },
  { h: 24, label: "24h" },
  { h: 24 * 7, label: "7d" },
  { h: 24 * 30, label: "30d" },
];

export default function TimelinePage() {
  const [hours, setHours] = useState(24);
  const [points, setPoints] = useState<{ at: string; clients: number | null }[]>([]);
  const [alerts, setAlerts] = useState<TimelineAlert[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusF, setStatusF] = useState<"all" | "open" | "resolved">("all");
  // Detail-list alert rows open the same "what happened here?" dialog the
  // strip markers use, instead of dumping the operator on the Alerts tab.
  const [moment, setMoment] = useState<{ at: number; label: string } | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const until = new Date();
    const since = new Date(until.getTime() - hours * 60 * 60 * 1000);
    const sinceIso = since.toISOString();
    const untilIso = until.toISOString();

    Promise.all([
      fetch(`/api/admin/metrics?hours=${hours}`).then((r) => r.json()),
      fetch(`/api/admin/alerts?since=${sinceIso}&until=${untilIso}`).then((r) => r.json()),
      fetch(`/api/admin/events?since=${sinceIso}&until=${untilIso}`).then((r) => r.json()),
    ])
      .then(([metrics, alertsRes, eventsRes]) => {
        if (!live) return;
        setPoints(metrics.points ?? []);
        setAlerts([...(alertsRes.open ?? []), ...(alertsRes.recent ?? [])]);
        setEvents(eventsRes.events ?? []);
        setLoading(false);
      })
      .catch(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [hours]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return hours <= 24
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };
  const clients = points.map((p) => ({ t: fmt(p.at), v: p.clients }));

  const since = Date.now() - hours * 60 * 60 * 1000;
  const until = Date.now();
  const empty = !loading && points.length === 0 && alerts.length === 0 && events.length === 0;

  // Open/resolved filter: alerts by resolvedAt; events map to active/ended.
  const shownAlerts = useMemo(
    () =>
      statusF === "all"
        ? alerts
        : alerts.filter((a) => (a.resolvedAt === null) === (statusF === "open")),
    [alerts, statusF],
  );
  const shownEvents = useMemo(
    () =>
      statusF === "all"
        ? events
        : events.filter((e) => (new Date(e.endsAt) >= new Date()) === (statusF === "open")),
    [events, statusF],
  );
  const openCount = alerts.filter((a) => a.resolvedAt === null).length;
  const statusCounts = { all: alerts.length, open: openCount, resolved: alerts.length - openCount };

  const timelineItems = useMemo(() => {
    const items = [
      ...shownAlerts.map((a) => ({
        key: `a${a.id}`,
        kind: "alert" as const,
        // The dialog opens at the ONSET so the cause is in the window.
        at: new Date(a.firstSeenAt).getTime(),
        momentLabel: `${a.targetName}: ${a.message}`,
        time: a.resolvedAt ?? a.firstSeenAt,
        label: `${a.severity === "error" ? "Alert" : "Warning"} — ${a.targetName}: ${a.message}`,
        status: a.resolvedAt ? "resolved" : "open",
      })),
      ...shownEvents.map((e) => ({
        key: `e${e.id}`,
        kind: "event" as const,
        at: new Date(e.startsAt).getTime(),
        momentLabel: `Event — ${e.name}`,
        time: e.startsAt,
        label: `Event — ${e.name}`,
        status: new Date(e.endsAt) < new Date() ? "ended" : "active",
      })),
    ];
    return items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }, [shownAlerts, shownEvents]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Assurance Timeline</h1>
          <p className="text-sm text-muted-foreground">
            Connected-client trend correlated with alert activity and events on the same time axis.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-md border">
            {(["all", "open", "resolved"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusF(s)}
                className={`px-3 py-1.5 text-sm ${statusF === s ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              >
                {s === "all" ? "All" : s === "open" ? "Open" : "Resolved"} ({statusCounts[s]})
              </button>
            ))}
          </div>
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

      {empty ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No metric samples, alerts, or events in this window.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connected clients</CardTitle>
            <CardDescription>Requires metric history sampling enabled in Settings → Monitoring.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <TimeSeriesChart data={clients} label="Clients" color="var(--chart-2)" />
            <AssuranceTimelineStrip since={since} until={until} alerts={shownAlerts} events={shownEvents} />
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-600" /> Alert (error)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> Alert (warning)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-3 rounded bg-indigo-400/50" /> Event
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline detail</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {timelineItems.map((it) => (
              <li key={it.key} className="border-b last:border-0">
                <button
                  type="button"
                  onClick={() => setMoment({ at: it.at, label: it.momentLabel })}
                  className="flex w-full items-center justify-between gap-3 rounded px-1 py-2 text-left hover:bg-muted"
                  title="What happened at this moment?"
                >
                  <span>{it.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(it.time).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {it.status}
                  </span>
                </button>
              </li>
            ))}
            {timelineItems.length === 0 && !loading && (
              <li className="text-center text-muted-foreground">No alerts or events in this window</li>
            )}
          </ul>
          <TimelineMomentDialog
            at={moment?.at ?? null}
            label={moment?.label ?? ""}
            onClose={() => setMoment(null)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
