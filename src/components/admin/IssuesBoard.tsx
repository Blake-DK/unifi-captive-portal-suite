"use client";

import { useMemo, useState } from "react";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type BoardIssue = {
  severity: "error" | "warning";
  category: string; // device | subsystem | port | radio | client | alert | blocked
  deviceMac?: string;
  deviceName?: string;
  text: string;
  sinceLabel?: string; // for alert-sourced rows
};

const CATEGORY_LABEL: Record<string, string> = {
  device: "Device",
  subsystem: "Subsystem",
  port: "Port",
  radio: "Radio",
  client: "Client",
  alert: "Alert",
  blocked: "Blocked",
};

function SevIcon({ s }: { s: "error" | "warning" }) {
  return s === "error" ? (
    <CircleAlert aria-label="Error" className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
  ) : (
    <TriangleAlert aria-label="Warning" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
  );
}

/**
 * The NOC board: every current issue in one place, grouped by device,
 * errors first, filterable by severity/category/text.
 */
export function IssuesBoard({ issues }: { issues: BoardIssue[] }) {
  const [q, setQ] = useState("");
  const [sev, setSev] = useState<"all" | "error" | "warning">("all");
  const [cat, setCat] = useState<string>("all");

  const categories = useMemo(() => [...new Set(issues.map((i) => i.category))].sort(), [issues]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return issues.filter(
      (i) =>
        (sev === "all" || i.severity === sev) &&
        (cat === "all" || i.category === cat) &&
        (!needle ||
          i.text.toLowerCase().includes(needle) ||
          (i.deviceName ?? "").toLowerCase().includes(needle) ||
          (i.deviceMac ?? "").includes(needle)),
    );
  }, [issues, q, sev, cat]);

  // Group by device; site-wide (no device) rows first under "Site".
  const groups = useMemo(() => {
    const byDevice = new Map<string, { name: string; items: BoardIssue[] }>();
    for (const i of filtered) {
      const key = i.deviceMac ?? "__site__";
      const cur = byDevice.get(key) ?? { name: i.deviceMac ? (i.deviceName ?? i.deviceMac) : "Site-wide", items: [] };
      cur.items.push(i);
      byDevice.set(key, cur);
    }
    return [...byDevice.entries()].sort(([a], [b]) =>
      a === "__site__" ? -1 : b === "__site__" ? 1 : 0,
    );
  }, [filtered]);

  const errors = filtered.filter((i) => i.severity === "error").length;
  const warnings = filtered.length - errors;
  const chip = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm ${active ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search device, port, client…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <div className="flex overflow-hidden rounded-md border">
          {(["all", "error", "warning"] as const).map((s) => (
            <button key={s} onClick={() => setSev(s)} className={chip(sev === s)}>
              {s === "all" ? "All" : s === "error" ? "Errors" : "Warnings"}
            </button>
          ))}
        </div>
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c] ?? c}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          {errors} error{errors !== 1 ? "s" : ""}, {warnings} warning{warnings !== 1 ? "s" : ""}
        </span>
      </div>

      {groups.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {issues.length === 0 ? "No issues detected — the network is clean." : "Nothing matches the filter."}
          </CardContent>
        </Card>
      )}

      {groups.map(([key, g]) => (
        <Card key={key}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              {g.name}
              <span className="text-xs font-normal text-muted-foreground">
                {g.items.length} issue{g.items.length !== 1 ? "s" : ""}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {g.items.map((i, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <SevIcon s={i.severity} />
                  <span>
                    <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {CATEGORY_LABEL[i.category] ?? i.category}
                    </span>
                    {i.text}
                    {i.sinceLabel && <span className="ml-1 text-xs text-muted-foreground">({i.sinceLabel})</span>}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
