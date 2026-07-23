"use client";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Moment = {
  at: number;
  windowMin: number;
  alerts: {
    id: number;
    targetName: string;
    type: string;
    severity: string;
    message: string;
    value: string | null;
    firstSeenAt: string;
    resolvedAt: string | null;
    openAtMoment: boolean;
  }[];
  controllerEvents: { time: number; key: string; msg: string; device: string | null }[];
  controllerError: string | null;
  audits: { id: number; at: string; actor: string; action: string; target: string | null; outcome: string }[];
  guestEvents: { id: number; name: string; startsAt: string; endsAt: string }[];
  error?: string;
};

const time = (t: string | number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Everything the portal knows about one instant on the assurance timeline. */
export function TimelineMomentDialog({
  at,
  label,
  onClose,
}: {
  at: number | null;
  label: string;
  onClose: () => void;
}) {
  const [windowMin, setWindowMin] = useState(15);
  const [data, setData] = useState<Moment | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (at === null) return;
    setLoading(true);
    setData(null);
    fetch(`/api/admin/timeline/moment?at=${at}&window=${windowMin}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ error: "Could not load this moment." } as Moment))
      .finally(() => setLoading(false));
  }, [at, windowMin]);

  return (
    <Dialog open={at !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{at !== null ? new Date(at).toLocaleString() : ""}</DialogTitle>
          <DialogDescription>
            {label} — everything that happened within ±{windowMin} minutes: alerts, the
            controller&apos;s own events, guest events, and admin actions.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Window</span>
          {[5, 15, 60].map((w) => (
            <Button
              key={w}
              type="button"
              size="sm"
              variant={windowMin === w ? "default" : "outline"}
              className="h-7 px-2"
              onClick={() => setWindowMin(w)}
            >
              ±{w}m
            </Button>
          ))}
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data?.error && <p className="text-sm text-destructive">{data.error}</p>}

        {data && !data.error && (
          <div className="space-y-4 text-sm">
            <section>
              <h3 className="mb-1 font-medium">Alerts ({data.alerts.length})</h3>
              {data.alerts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No alerts in this window.</p>
              ) : (
                <ul className="space-y-1">
                  {data.alerts.map((a) => (
                    <li key={a.id} className="rounded border p-2 text-xs">
                      <span
                        className={
                          a.severity === "error"
                            ? "font-medium text-destructive"
                            : "font-medium text-amber-600 dark:text-amber-400"
                        }
                      >
                        {a.targetName}
                      </span>{" "}
                      — {a.message}
                      {a.value ? ` (${a.value})` : ""}
                      <div className="text-muted-foreground">
                        fired {time(a.firstSeenAt)}
                        {a.resolvedAt ? ` · resolved ${time(a.resolvedAt)}` : " · still open"}
                        {a.openAtMoment && " · ongoing at this instant"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-1 font-medium">Controller events ({data.controllerEvents.length})</h3>
              {data.controllerError ? (
                <p className="text-xs text-destructive">{data.controllerError}</p>
              ) : data.controllerEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">The controller logged nothing in this window.</p>
              ) : (
                <ul className="space-y-0.5">
                  {data.controllerEvents.map((e, i) => (
                    <li key={i} className="flex gap-2 text-xs">
                      <span className="shrink-0 font-mono text-muted-foreground">{time(e.time)}</span>
                      <span className="shrink-0 font-mono text-muted-foreground">{e.key}</span>
                      <span>{e.msg || e.device}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {data.guestEvents.length > 0 && (
              <section>
                <h3 className="mb-1 font-medium">Guest events running</h3>
                <ul className="text-xs text-muted-foreground">
                  {data.guestEvents.map((e) => (
                    <li key={e.id}>
                      {e.name} — {time(e.startsAt)} to {time(e.endsAt)}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3 className="mb-1 font-medium">Admin actions ({data.audits.length})</h3>
              {data.audits.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nobody changed anything in this window.</p>
              ) : (
                <ul className="space-y-0.5">
                  {data.audits.map((a) => (
                    <li key={a.id} className="flex gap-2 text-xs">
                      <span className="shrink-0 font-mono text-muted-foreground">{time(a.at)}</span>
                      <span className="font-medium">{a.actor}</span>
                      <span className="font-mono">{a.action}</span>
                      {a.target && <span className="truncate text-muted-foreground">{a.target}</span>}
                      {a.outcome !== "success" && <span className="text-destructive">{a.outcome}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
