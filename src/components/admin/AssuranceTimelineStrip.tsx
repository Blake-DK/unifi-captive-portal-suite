"use client";
import { useState } from "react";
import { TimelineMomentDialog } from "./TimelineMomentDialog";

export type TimelineAlert = {
  id: number;
  targetName: string;
  severity: string;
  message: string;
  firstSeenAt: string;
  resolvedAt: string | null;
};

export type TimelineEvent = {
  id: number;
  name: string;
  startsAt: string;
  endsAt: string;
};

/** Horizontal strip: event spans + alert-onset markers plotted on a shared time axis. */
export function AssuranceTimelineStrip({
  since,
  until,
  alerts,
  events,
}: {
  since: number;
  until: number;
  alerts: TimelineAlert[];
  events: TimelineEvent[];
}) {
  const span = Math.max(1, until - since);
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - since) / span) * 100));
  // Clicking a marker asks "what happened here?" rather than dumping the
  // operator on the Alerts tab to reconstruct the moment by hand.
  const [moment, setMoment] = useState<{ at: number; label: string } | null>(null);

  return (
    <div className="space-y-1">
      <div className="relative h-10 rounded-md border bg-muted/30">
        {events.map((e) => {
          const start = Math.max(since, new Date(e.startsAt).getTime());
          const end = Math.min(until, new Date(e.endsAt).getTime());
          if (end < since || start > until) return null;
          const left = pct(start);
          const width = Math.max(0.5, pct(end) - left);
          return (
            <a
              key={`ev-${e.id}`}
              href="/admin/events"
              title={`Event: ${e.name} — open Events`}
              className="absolute top-1 h-3 cursor-pointer rounded bg-indigo-400/50 hover:ring-2 hover:ring-indigo-500 dark:bg-indigo-500/40"
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          );
        })}
        {alerts.map((a) => {
          const raw = new Date(a.firstSeenAt).getTime();
          if (raw > until) return null;
          const t = pct(Math.max(since, raw));
          const color = a.severity === "error" ? "bg-rose-600" : "bg-amber-500";
          return (
            <button
              key={`al-${a.id}`}
              type="button"
              onClick={() => setMoment({ at: raw, label: `${a.targetName}: ${a.message}` })}
              title={`${a.resolvedAt ? "Resolved" : "Open"} — ${a.targetName}: ${a.message} — click for the full picture`}
              aria-label={`What happened at ${new Date(raw).toLocaleString()}`}
              className={`absolute bottom-1 h-3 w-1.5 cursor-pointer rounded-full ${color} hover:ring-2 hover:ring-offset-1`}
              style={{ left: `${t}%` }}
            />
          );
        })}
      </div>
      <TimelineMomentDialog
        at={moment?.at ?? null}
        label={moment?.label ?? ""}
        onClose={() => setMoment(null)}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>
          {new Date(since).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </span>
        <span>Now</span>
      </div>
    </div>
  );
}
