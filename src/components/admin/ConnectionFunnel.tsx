"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientLink } from "@/components/admin/ClientWindows";

type Funnel = {
  hours: number;
  stages: { stage: string; total: number; failed: number }[];
  topFailers: { mac: string; failures: number; lastReason: string }[];
  windowEvents: number;
};

const STAGE_LABEL: Record<string, string> = {
  association: "Association",
  authentication: "Authentication",
  dhcp: "DHCP / addressing",
  roaming: "Roaming",
};

/** Meraki-style connection funnel — where clients stall getting online.
 * Loaded on mount; degrades quietly if the controller is unreachable. */
export function ConnectionFunnel() {
  const [data, setData] = useState<Funnel | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/admin/connection-funnel")
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        if (Array.isArray(d.stages)) setData(d);
        else setErr(d.error ?? "Could not load the funnel.");
      })
      .catch(() => live && setErr("Network error while loading the funnel."));
    return () => {
      live = false;
    };
  }, []);

  if (err) return null;
  if (!data) return null;
  if (data.windowEvents === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Connection funnel — last {data.hours}h
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          {data.stages.map((s) => {
            const rate = s.total > 0 ? (s.failed / s.total) * 100 : 0;
            const tone = rate >= 20 ? "text-destructive" : rate >= 5 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400";
            return (
              <div key={s.stage} className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">{STAGE_LABEL[s.stage] ?? s.stage}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{s.total}</p>
                <p className={`text-xs ${tone}`}>
                  {s.failed} failed{s.total > 0 ? ` · ${rate.toFixed(0)}%` : ""}
                </p>
              </div>
            );
          })}
        </div>
        {data.topFailers.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Clients failing most often
            </p>
            <ul className="space-y-1 text-sm">
              {data.topFailers.map((f) => (
                <li key={f.mac} className="flex flex-wrap items-baseline gap-x-2">
                  <ClientLink mac={f.mac}>
                    <span className="font-mono text-xs">{f.mac}</span>
                  </ClientLink>
                  <span className="text-muted-foreground">
                    {f.failures}× — {f.lastReason}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
