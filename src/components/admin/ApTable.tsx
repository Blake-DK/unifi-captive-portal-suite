"use client";

import { useMemo, useState } from "react";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableHead, useTableSort, type SortAccessors } from "@/components/admin/tableSort";
import { DeviceDialog } from "@/components/admin/DeviceDialog";
import type { TopoNode } from "@/lib/topology";

export type ApRow = {
  /** The per-device node the shared DeviceDialog consumes (same as map/Status). */
  node: TopoNode;
  /** Site-wide offline ignore — hidden by default, toggleable back in. */
  ignored: boolean;
  /** "08/07/2026" — when the ignore was placed (null when unknown). */
  ignoredSince: string | null;
  /** Tooltip: who ignored it and why (null when unknown). */
  ignoredTitle: string | null;
  mac: string;
  name: string;
  model: string;
  online: boolean;
  stateLabel: string;
  /** "3h 12m ago" when the device is not online (null when unknown). */
  lastSeen: string | null;
  version: string;
  upgradable: boolean;
  uptime: string;
  clients: number;
  satisfaction: number | null;
  cpuPct: number | null;
  memPct: number | null;
  radios: { band: string; channel: number | null; utilizationPct: number | null; clients: number | null }[];
  issues: { severity: "error" | "warning"; text: string }[];
};

function utilizationClass(pct: number | null): string {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 80) return "font-medium text-red-600 dark:text-red-400";
  if (pct >= 60) return "font-medium text-amber-600 dark:text-amber-400";
  return "";
}

const SORTS: SortAccessors<ApRow> = {
  ap: (r) => r.name,
  state: (r) => r.stateLabel,
  clients: (r) => r.clients,
  radios: (r) => Math.max(-1, ...r.radios.map((x) => x.utilizationPct ?? -1)),
  experience: (r) => r.satisfaction,
  cpu: (r) => r.cpuPct,
  uptime: (r) => r.uptime,
  firmware: (r) => r.version,
  issues: (r) => r.issues.length,
};

export function ApTable({
  rows,
  canControl = false,
  canIgnore = false,
}: {
  rows: ApRow[];
  canControl?: boolean;
  canIgnore?: boolean;
}) {
  const [q, setQ] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [statusF, setStatusF] = useState<"all" | "online" | "offline">("all");
  const [showIgnored, setShowIgnored] = useState(false);
  const [selected, setSelected] = useState<TopoNode | null>(null);

  const ignoredCount = rows.filter((r) => r.ignored).length;
  // Ignored devices leave the table AND every count unless toggled back in.
  const baseRows = useMemo(
    () => (showIgnored ? rows : rows.filter((r) => !r.ignored)),
    [rows, showIgnored],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return baseRows.filter(
      (r) =>
        (statusF === "all" || r.online === (statusF === "online")) &&
        (!onlyIssues || r.issues.length > 0 || !r.online) &&
        (!needle ||
          r.name.toLowerCase().includes(needle) ||
          r.model.toLowerCase().includes(needle) ||
          r.mac.toLowerCase().includes(needle)),
    );
  }, [baseRows, q, onlyIssues, statusF]);
  const { sorted, sort, toggle } = useTableSort(filtered, SORTS);

  const withIssues = baseRows.filter((r) => r.issues.length > 0 || !r.online).length;
  const onlineCount = baseRows.filter((r) => r.online).length;
  const statusCounts = { all: baseRows.length, online: onlineCount, offline: baseRows.length - onlineCount };
  const chip = (active: boolean) =>
    `px-3 py-1.5 text-sm ${active ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`;
  // A drag-select on a MAC/name ends in a click; an active selection means
  // the user was copying, not opening.
  const open = (node: TopoNode) => {
    if (window.getSelection()?.toString()) return;
    setSelected(node);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3 text-base">
          {baseRows.length} access point{baseRows.length !== 1 ? "s" : ""}
          {withIssues > 0 && (
            <span className="font-normal text-muted-foreground">— {withIssues} with issues</span>
          )}
          {!showIgnored && ignoredCount > 0 && (
            <span className="font-normal text-muted-foreground">
              — {ignoredCount} ignored hidden
            </span>
          )}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Input placeholder="Search name, model, MAC…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <div className="flex overflow-hidden rounded-md border">
            {(["all", "online", "offline"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setStatusF(s)} className={chip(statusF === s)}>
                {s === "all" ? "All" : s === "online" ? "Online" : "Offline"} ({statusCounts[s]})
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
            Only APs with issues
          </label>
          {ignoredCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showIgnored}
                onChange={(e) => setShowIgnored(e.target.checked)}
              />
              Show ignored ({ignoredCount})
            </label>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="AP" k="ap" sort={sort} onToggle={toggle} />
              <SortableHead label="State" k="state" sort={sort} onToggle={toggle} />
              <SortableHead label="Clients" k="clients" sort={sort} onToggle={toggle} />
              <SortableHead label="Radios (ch · util · clients)" k="radios" sort={sort} onToggle={toggle} />
              <SortableHead label="Experience" k="experience" sort={sort} onToggle={toggle} />
              <SortableHead label="CPU / Mem" k="cpu" sort={sort} onToggle={toggle} />
              <SortableHead label="Uptime" k="uptime" sort={sort} onToggle={toggle} />
              <SortableHead label="Firmware" k="firmware" sort={sort} onToggle={toggle} />
              <SortableHead label="Issues" k="issues" sort={sort} onToggle={toggle} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow
                key={r.mac}
                tabIndex={0}
                aria-label={`Open ${r.name}`}
                className="cursor-pointer"
                onClick={() => open(r.node)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open(r.node);
                  }
                }}
              >
                <TableCell>
                  <span className="font-medium">{r.name}</span>
                  <span className="block text-xs text-muted-foreground">{r.model} · <span className="font-mono">{r.mac}</span></span>
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center gap-1.5 text-xs ${r.online ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${r.online ? "bg-emerald-500" : "bg-red-500"}`} />
                    {r.stateLabel}
                  </span>
                  {r.ignored && (
                    <span
                      className="ml-1.5 rounded bg-muted px-1.5 text-[10px] text-muted-foreground"
                      title={r.ignoredTitle ?? undefined}
                    >
                      ignored{r.ignoredSince ? ` since ${r.ignoredSince}` : ""}
                    </span>
                  )}
                  {!r.online && r.lastSeen && (
                    <span className="block text-[11px] text-muted-foreground">last seen {r.lastSeen}</span>
                  )}
                </TableCell>
                <TableCell>{r.clients}</TableCell>
                <TableCell className="text-xs">
                  {r.radios.length === 0
                    ? "-"
                    : r.radios.map((radio, i) => (
                        <span key={i} className="mr-3 whitespace-nowrap">
                          {radio.band} ch{radio.channel ?? "?"} ·{" "}
                          <span className={utilizationClass(radio.utilizationPct)}>{radio.utilizationPct ?? "?"}%</span> ·{" "}
                          {radio.clients ?? 0} sta
                        </span>
                      ))}
                </TableCell>
                <TableCell className="text-xs">
                  {r.satisfaction !== null ? `${r.satisfaction}%` : "-"}
                </TableCell>
                <TableCell className="text-xs">
                  {r.cpuPct !== null ? `${r.cpuPct.toFixed(0)}% / ${r.memPct?.toFixed(0) ?? "?"}%` : "-"}
                </TableCell>
                <TableCell className="text-xs">{r.uptime}</TableCell>
                <TableCell className="text-xs">
                  {r.version}
                  {r.upgradable && <span className="ml-1 text-amber-600 dark:text-amber-400">(update)</span>}
                </TableCell>
                <TableCell>
                  {r.issues.length === 0 ? (
                    <span className="text-xs text-muted-foreground">-</span>
                  ) : (
                    <div className="space-y-0.5">
                      {r.issues.map((i, idx) => (
                        <p key={idx} className="flex items-start gap-1.5 text-xs">
                          {i.severity === "error" ? (
                            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
                          ) : (
                            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                          )}
                          {i.text}
                        </p>
                      ))}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  {rows.length === 0 ? "No access points reported" : "Nothing matches the filter"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <DeviceDialog
          node={selected}
          onClose={() => setSelected(null)}
          canControl={canControl}
          canIgnore={canIgnore}
          issues={selected ? (rows.find((r) => r.node.mac === selected.mac)?.issues ?? []) : []}
        />
      </CardContent>
    </Card>
  );
}
