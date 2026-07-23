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

type LogRow = {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  macAddress: string;
  locationType: string;
  locationName: string | null;
  baseLocation: string | null;
  building: string | null;
  roomNumber: string | null;
  authorizedAt: string;
};

function locationLabel(r: LogRow): string {
  const parts = [r.building, r.roomNumber].filter(Boolean).join(" / Rm ");
  if (r.locationName) return parts ? `${r.locationName} — ${parts}` : r.locationName;
  // Legacy rows written before editable locations existed.
  if (r.locationType === "base") return r.baseLocation ?? "On Base";
  if (r.locationType === "deployed") return parts || "Deployed";
  return parts || "—";
}

// Sorting is client-side, so it orders the current page of results.
const SORTS: SortAccessors<LogRow> = {
  id: (r) => r.id,
  firstName: (r) => r.firstName,
  lastName: (r) => r.lastName,
  phone: (r) => r.phone,
  type: (r) => r.locationType,
  location: (r) => locationLabel(r),
  mac: (r) => r.macAddress,
  when: (r) => r.authorizedAt,
};

export function LogsTable() {
  const [q, setQ] = usePersistentState("portal.logs.q", "");
  const [from, setFrom] = usePersistentState("portal.logs.from", "");
  const [to, setTo] = usePersistentState("portal.logs.to", "");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [data, setData] = useState<{ rows: LogRow[]; total: number }>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);

  const buildParams = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({
      ...(q && { q }),
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
    const res = await fetch(`/api/admin/logs?${buildParams()}`);
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
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">Search (name)</label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to search…" />
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
            <a href={`/api/admin/logs?${buildParams({ format: "csv" })}`} download>
              Export CSV
            </a>
          </Button>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="ID" k="id" sort={sort} onToggle={toggle} />
                <SortableHead label="First Name" k="firstName" sort={sort} onToggle={toggle} />
                <SortableHead label="Last Name" k="lastName" sort={sort} onToggle={toggle} />
                <SortableHead label="Phone" k="phone" sort={sort} onToggle={toggle} />
                <SortableHead label="Type" k="type" sort={sort} onToggle={toggle} />
                <SortableHead label="Location" k="location" sort={sort} onToggle={toggle} />
                <SortableHead label="MAC" k="mac" sort={sort} onToggle={toggle} />
                <SortableHead label="Date / Time" k="when" sort={sort} onToggle={toggle} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No records found
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.id}</TableCell>
                    <TableCell className="font-medium">{r.firstName}</TableCell>
                    <TableCell className="font-medium">{r.lastName}</TableCell>
                    <TableCell>{r.phone}</TableCell>
                    <TableCell className="capitalize">{r.locationType}</TableCell>
                    <TableCell>{locationLabel(r)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.macAddress}</TableCell>
                    <TableCell>{new Date(r.authorizedAt).toLocaleString("en-GB")}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {data.total} record{data.total !== 1 ? "s" : ""} — page {page} of {totalPages}
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
