"use client";

import { useEffect, useState } from "react";
import { usePersistentState } from "@/lib/usePersistentState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { SortableHead, useTableSort, type SortAccessors } from "@/components/admin/tableSort";

type AuditRow = {
  id: number;
  createdAt: string;
  actorType: string;
  actor: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  outcome: string;
};

const ACTION_GROUPS = [
  { value: "", label: "All actions" },
  { value: "admin.", label: "Admin logins & denials" },
  { value: "account.", label: "Admin accounts" },
  { value: "settings.", label: "Settings" },
  { value: "unifi.", label: "UniFi config" },
  { value: "guest.", label: "Guests & devices" },
  { value: "traffic.", label: "Traffic lookups" },
];

function detailText(detail: AuditRow["detail"]): string {
  if (!detail) return "";
  return Object.entries(detail)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join(" · ");
}

function outcomeBadge(outcome: string) {
  if (outcome === "success") return null;
  const cls =
    outcome === "denied"
      ? "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300"
      : "bg-red-100 text-red-800";
  return (
    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${cls}`}>
      {outcome}
    </span>
  );
}

// Sorting is client-side, so it orders the current page of results.
const SORTS: SortAccessors<AuditRow> = {
  time: (r) => r.createdAt,
  actor: (r) => r.actor,
  action: (r) => r.action,
  target: (r) => r.target ?? "",
  detail: (r) => detailText(r.detail),
  ip: (r) => r.ip ?? "",
};

export function AuditTable() {
  const [q, setQ] = usePersistentState("portal.audit.q", "");
  const [action, setAction] = usePersistentState("portal.audit.action", "");
  const [from, setFrom] = usePersistentState("portal.audit.from", "");
  const [to, setTo] = usePersistentState("portal.audit.to", "");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [data, setData] = useState<{ rows: AuditRow[]; total: number }>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);

  const buildParams = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({
      ...(q && { q }),
      ...(action && { action }),
      ...(from && { from }),
      ...(to && { to }),
      page: String(page),
      pageSize: String(pageSize),
      ...extra,
    });
    return p.toString();
  };

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/audit?${buildParams()}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const { sorted, sort, toggle } = useTableSort(data.rows, SORTS);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1">
            <label className="text-xs text-muted-foreground">Search (actor / target)</label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Username, phone, MAC…" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Action</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              {ACTION_GROUPS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button
            onClick={() => {
              setPage(1);
              load();
            }}
          >
            Filter
          </Button>
          <Button variant="outline" asChild>
            <a href={`/api/admin/audit?${buildParams({ format: "csv" })}`} download>
              Export CSV
            </a>
          </Button>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Time" k="time" sort={sort} onToggle={toggle} />
                <SortableHead label="Actor" k="actor" sort={sort} onToggle={toggle} />
                <SortableHead label="Action" k="action" sort={sort} onToggle={toggle} />
                <SortableHead label="Target" k="target" sort={sort} onToggle={toggle} />
                <SortableHead label="Detail" k="detail" sort={sort} onToggle={toggle} />
                <SortableHead label="IP" k="ip" sort={sort} onToggle={toggle} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No audit entries found
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(r.createdAt).toLocaleString("en-GB")}
                    </TableCell>
                    <TableCell className="font-medium">
                      {r.actor}
                      <span className="ml-1 text-xs text-muted-foreground">({r.actorType})</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {r.action}
                      {outcomeBadge(r.outcome)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.target ?? ""}</TableCell>
                    <TableCell className="max-w-[320px] truncate text-xs text-muted-foreground" title={detailText(r.detail)}>
                      {detailText(r.detail)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.ip ?? ""}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {data.total} entr{data.total !== 1 ? "ies" : "y"} — page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
