"use client";

import { useEffect, useState } from "react";
import { usePersistentState } from "@/lib/usePersistentState";
import Link from "next/link";
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

type UserRow = {
  phone: string;
  firstName: string;
  lastName: string;
  email: string | null;
  lastAuthorizedAt: string;
  activeDeviceCount: number;
};

// Sorting is client-side, so it orders the current page of results.
const SORTS: SortAccessors<UserRow> = {
  name: (r) => `${r.firstName} ${r.lastName}`,
  phone: (r) => r.phone,
  email: (r) => r.email ?? "",
  devices: (r) => r.activeDeviceCount,
  lastSeen: (r) => r.lastAuthorizedAt,
};

export function UsersTable() {
  const [q, setQ] = usePersistentState("portal.users.q", "");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [data, setData] = useState<{ rows: UserRow[]; total: number }>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const toggle = (phone: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(phone) ? next.delete(phone) : next.add(phone);
      return next;
    });

  const bulkDelete = async () => {
    const phones = [...selected];
    if (phones.length === 0) return;
    if (!confirm(`Delete ${phones.length} guest(s)? This disconnects their active devices and permanently removes all their registrations.`)) return;
    setBulkBusy(true);
    let failed = 0;
    for (const phone of phones) {
      try {
        const res = await fetch(`/api/admin/users/${encodeURIComponent(phone)}`, { method: "DELETE" });
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    if (failed > 0) alert(`${failed} of ${phones.length} could not be deleted.`);
    await load();
  };

  const buildParams = () =>
    new URLSearchParams({
      ...(q && { q }),
      page: String(page),
      pageSize: String(pageSize),
    }).toString();

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/users?${buildParams()}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const { sorted, sort, toggle: toggleSort } = useTableSort(data.rows, SORTS);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <label className="text-xs text-muted-foreground">Search (name, phone, email)</label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to search…" />
          </div>
          <Button
            onClick={() => {
              setPage(1);
              load();
            }}
          >
            Filter
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/users/new">Register Guest</Link>
          </Button>
        </div>

        {selected.size > 0 && (
          <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span>{selected.size} selected</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelected(new Set())} disabled={bulkBusy}>
                Clear
              </Button>
              <Button variant="destructive" size="sm" onClick={bulkDelete} disabled={bulkBusy}>
                {bulkBusy ? "Deleting…" : `Delete ${selected.size} selected`}
              </Button>
            </div>
          </div>
        )}

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={data.rows.length > 0 && data.rows.every((r) => selected.has(r.phone))}
                    onChange={(e) =>
                      setSelected((s) => {
                        const next = new Set(s);
                        for (const r of data.rows) e.target.checked ? next.add(r.phone) : next.delete(r.phone);
                        return next;
                      })
                    }
                  />
                </TableHead>
                <SortableHead label="Name" k="name" sort={sort} onToggle={toggleSort} />
                <SortableHead label="Phone" k="phone" sort={sort} onToggle={toggleSort} />
                <SortableHead label="Email" k="email" sort={sort} onToggle={toggleSort} />
                <SortableHead label="Devices" k="devices" sort={sort} onToggle={toggleSort} />
                <SortableHead label="Last Seen" k="lastSeen" sort={sort} onToggle={toggleSort} />
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : data.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((r) => (
                  <TableRow key={r.phone} data-state={selected.has(r.phone) ? "selected" : undefined}>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.firstName} ${r.lastName}`}
                        checked={selected.has(r.phone)}
                        onChange={() => toggle(r.phone)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {r.firstName} {r.lastName}
                    </TableCell>
                    <TableCell>{r.phone}</TableCell>
                    <TableCell>{r.email ?? "-"}</TableCell>
                    <TableCell>{r.activeDeviceCount}</TableCell>
                    <TableCell>{new Date(r.lastAuthorizedAt).toLocaleString("en-GB")}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/admin/users/${encodeURIComponent(r.phone)}`}
                        className="text-sm underline hover:text-foreground"
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {data.total} user{data.total !== 1 ? "s" : ""} — page {page} of {totalPages}
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
