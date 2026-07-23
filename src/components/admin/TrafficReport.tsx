"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBytes } from "@/lib/utils";
import { SortableHead, useTableSort, type SortAccessors } from "@/components/admin/tableSort";
import { RandomMacBadge } from "@/components/admin/RandomMacBadge";
import { ClientLink } from "@/components/admin/ClientWindows";

type AppRow = { name: string; category: string; rx: number; tx: number; total: number };
type CategoryRow = { name: string; rx: number; tx: number; total: number };
type ClientRow = {
  mac: string;
  deviceName: string | null;
  total: number;
  guest: { phone: string; name: string } | null;
};
type DeviceRow = {
  mac: string;
  label: string | null;
  deviceName: string | null;
  total: number;
  apps: AppRow[];
};
type Report = {
  hours?: number;
  apps?: AppRow[];
  categories?: CategoryRow[];
  clients?: ClientRow[];
  devices?: DeviceRow[];
  error?: string;
};

const HOURS = [
  { value: 24, label: "24 hours" },
  { value: 72, label: "3 days" },
  { value: 168, label: "7 days" },
  { value: 720, label: "30 days" },
];

function usageText(total: number, sum: number) {
  const pct = sum > 0 ? Math.round((total / sum) * 100) : 0;
  return (
    <span className="text-xs">
      {formatBytes(total)} <span className="text-muted-foreground">· {pct}%</span>
    </span>
  );
}

function sumTotals(items?: { total: number }[]): number {
  return items?.reduce((s, i) => s + i.total, 0) ?? 0;
}

const CAT_SORTS: SortAccessors<CategoryRow> = {
  name: (r) => r.name,
  usage: (r) => r.total,
};
const APP_SORTS: SortAccessors<AppRow> = {
  name: (r) => r.name,
  category: (r) => r.category,
  usage: (r) => r.total,
};
const CLIENT_SORTS: SortAccessors<ClientRow> = {
  guest: (r) => r.guest?.name ?? "",
  device: (r) => r.deviceName ?? "",
  mac: (r) => r.mac,
  usage: (r) => r.total,
};

/**
 * DPI traffic report. `phone` scopes it to one guest's devices; without it,
 * the whole site. The API enforces the traffic grant — a 403 renders as an
 * access notice.
 */
export function TrafficReport({ phone }: { phone?: string }) {
  const [hours, setHours] = useState(24);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const url = phone
      ? `/api/admin/users/${encodeURIComponent(phone)}/traffic?hours=${hours}`
      : `/api/admin/traffic?hours=${hours}`;
    const res = await fetch(url);
    const data: Report = await res.json().catch(() => ({ error: "Bad response" }));
    setReport(data);
    setLoading(false);
  }, [phone, hours]);

  useEffect(() => {
    load();
  }, [load]);

  const sumApps = sumTotals(report?.apps);
  const sumCats = sumTotals(report?.categories);
  const sumClients = sumTotals(report?.clients);
  const cats = useTableSort(report?.categories ?? [], CAT_SORTS);
  const apps = useTableSort((report?.apps ?? []).slice(0, 20), APP_SORTS);
  const clients = useTableSort(report?.clients ?? [], CLIENT_SORTS);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {HOURS.map((h) => (
          <button
            key={h.value}
            type="button"
            onClick={() => setHours(h.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              hours === h.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {h.label}
          </button>
        ))}
        {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>

      {report?.error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {report.error}
        </div>
      )}

      {!report?.error && report && (
        <>
          {(report.apps?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              No traffic data recorded in this window.
            </p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Categories</CardTitle>
                  <CardDescription>Where the traffic goes, by type</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableHead label="Category" k="name" sort={cats.sort} onToggle={cats.toggle} />
                        <SortableHead label="Usage" k="usage" sort={cats.sort} onToggle={cats.toggle} />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cats.sorted.map((c) => (
                        <TableRow key={c.name}>
                          <TableCell>{c.name}</TableCell>
                          <TableCell>{usageText(c.total, sumCats)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Top Apps &amp; Services</CardTitle>
                  <CardDescription>Identified by UniFi traffic inspection</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableHead label="App" k="name" sort={apps.sort} onToggle={apps.toggle} />
                        <SortableHead
                          label="Category"
                          k="category"
                          sort={apps.sort}
                          onToggle={apps.toggle}
                          className="hidden sm:table-cell"
                        />
                        <SortableHead label="Usage" k="usage" sort={apps.sort} onToggle={apps.toggle} />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {apps.sorted.map((a) => (
                        <TableRow key={`${a.category}/${a.name}`}>
                          <TableCell>{a.name}</TableCell>
                          <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                            {a.category}
                          </TableCell>
                          <TableCell>{usageText(a.total, sumApps)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {report.clients && report.clients.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Top Clients</CardTitle>
                <CardDescription>Heaviest users in this window</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHead label="Guest" k="guest" sort={clients.sort} onToggle={clients.toggle} />
                      <SortableHead label="Device" k="device" sort={clients.sort} onToggle={clients.toggle} />
                      <SortableHead
                        label="MAC"
                        k="mac"
                        sort={clients.sort}
                        onToggle={clients.toggle}
                        className="hidden sm:table-cell"
                      />
                      <SortableHead label="Usage" k="usage" sort={clients.sort} onToggle={clients.toggle} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clients.sorted.map((c) => (
                      <TableRow key={c.mac}>
                        <TableCell>
                          {c.guest ? (
                            <a href={`/admin/users/${encodeURIComponent(c.guest.phone)}`} className="underline">
                              {c.guest.name}
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not a portal guest</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <ClientLink mac={c.mac} hint={c.deviceName ?? undefined}>
                            {c.deviceName ?? "—"}
                          </ClientLink>
                        </TableCell>
                        <TableCell className="hidden font-mono text-xs sm:table-cell">
                          <ClientLink mac={c.mac} hint={c.deviceName ?? undefined}>{c.mac}</ClientLink>
                          <RandomMacBadge mac={c.mac} className="ml-1.5" />
                        </TableCell>
                        <TableCell>{usageText(c.total, sumClients)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {report.devices && report.devices.length > 0 && (
            <div className="space-y-4">
              {report.devices.map((d) => (
                <Card key={d.mac}>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {d.label || d.deviceName || d.mac}
                    </CardTitle>
                    <CardDescription>
                      <span className="font-mono">{d.mac}</span> — {formatBytes(d.total)} in this window
                    </CardDescription>
                  </CardHeader>
                  {d.apps.length > 0 && (
                    <CardContent>
                      <Table>
                        <TableBody>
                          {d.apps.map((a) => (
                            <TableRow key={`${a.category}/${a.name}`}>
                              <TableCell>{a.name}</TableCell>
                              <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                                {a.category}
                              </TableCell>
                              <TableCell>{usageText(a.total, sumTotals(d.apps))}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
