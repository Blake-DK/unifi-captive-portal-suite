"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ClientLink } from "@/components/admin/ClientWindows";
import { PcapButton } from "@/components/admin/PcapButton";
import { DeviceTypeChips, type DeviceTypeFilterValue } from "@/components/admin/DeviceTypeChips";
import { classifyDevice } from "@/lib/deviceType";
import { toCSV } from "@/lib/csv";
import { downloadBlob } from "@/lib/utils";
import { SortableHead, useTableSort, type SortAccessors } from "@/components/admin/tableSort";
import { RandomMacBadge } from "@/components/admin/RandomMacBadge";

export type PortDevice = {
  name: string;
  mac: string;
  kind: "client" | "device"; // device = adopted UniFi gear (AP/switch/gateway)
  note?: string;
};

export type PortRow = {
  switchName: string;
  switchMac: string;
  switchType?: string;
  ignored: boolean; // the owning switch is ignored site-wide (offline on purpose)
  ignoredSince: string | null; // "08/07/2026" — when the ignore was placed
  ignoredTitle: string | null; // tooltip: who ignored it and why
  portIdx: number;
  portName: string;
  up: boolean;
  speed?: number;
  poeWatts?: number;
  vlanSummary: string;
  connected: PortDevice[];
};

const SORTS: SortAccessors<PortRow> = {
  switch: (r) => r.switchName,
  port: (r) => r.portIdx,
  link: (r) => (r.up ? (r.speed ?? 0) : -1),
  poe: (r) => r.poeWatts ?? 0,
  vlans: (r) => r.vlanSummary,
  connected: (r) => r.connected[0]?.name ?? "",
};

export function PortInventoryTable({
  rows,
  canCapture = false,
}: {
  rows: PortRow[];
  canCapture?: boolean;
}) {
  const [q, setQ] = useState("");
  const [sw, setSw] = useState("all");
  const [link, setLink] = useState<"all" | "up" | "down">("all");
  const [poeOnly, setPoeOnly] = useState(false);
  const [devType, setDevType] = useState<DeviceTypeFilterValue>("all");
  const [showIgnored, setShowIgnored] = useState(false);

  // Ignored switches leave the table AND every count unless toggled back in
  // (their port data is last-known, not live) — same deal as the APs table.
  const ignoredSwitchCount = useMemo(
    () => new Set(rows.filter((r) => r.ignored).map((r) => r.switchMac)).size,
    [rows],
  );
  const baseRows = useMemo(
    () => (showIgnored ? rows : rows.filter((r) => !r.ignored)),
    [rows, showIgnored],
  );

  const typeCounts = useMemo(() => {
    const c: Record<DeviceTypeFilterValue, number> = { all: 0, AP: 0, DN: 0, AN: 0, CN: 0, CAN: 0, UBB: 0, unknown: 0 };
    const seen = new Set<string>();
    for (const r of baseRows) {
      if (seen.has(r.switchMac)) continue; // count each switch once, not each port
      seen.add(r.switchMac);
      c.all++;
      c[classifyDevice(r.switchName, r.switchType) ?? "unknown"]++;
    }
    return c;
  }, [baseRows]);

  const switches = useMemo(
    () => [...new Set(baseRows.map((r) => r.switchName))].sort((a, b) => a.localeCompare(b)),
    [baseRows],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return baseRows.filter(
      (r) =>
        (sw === "all" || r.switchName === sw) &&
        (devType === "all" ||
          (devType === "unknown"
            ? classifyDevice(r.switchName, r.switchType) === null
            : classifyDevice(r.switchName, r.switchType) === devType)) &&
        (link === "all" || (link === "up") === r.up) &&
        (!poeOnly || (r.poeWatts ?? 0) > 0) &&
        (!needle ||
          [
            r.switchName,
            r.portName,
            r.vlanSummary,
            ...r.connected.flatMap((c) => [c.name, c.mac, c.note]),
          ]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(needle))),
    );
  }, [baseRows, q, sw, link, poeOnly, devType]);
  const { sorted, sort, toggle } = useTableSort(filtered, SORTS);

  const exportCsv = () => {
    const csv = toCSV(
      filtered.map((r) => ({
        switch: r.switchName,
        port: r.portName ? `${r.portIdx} — ${r.portName}` : String(r.portIdx),
        link: r.up ? (r.speed ? (r.speed >= 1000 ? `${r.speed / 1000} GbE` : `${r.speed} Mb`) : "up") : "down",
        poe: r.poeWatts && r.poeWatts > 0 ? `${r.poeWatts.toFixed(1)} W` : "",
        vlans: r.vlanSummary,
        connected: r.connected.map((c) => `${c.name} (${c.mac})${c.note ? ` [${c.note}]` : ""}`).join("; "),
      })),
      [
        { key: "switch", header: "Switch" },
        { key: "port", header: "Port" },
        { key: "link", header: "Link" },
        { key: "poe", header: "PoE" },
        { key: "vlans", header: "VLANs" },
        { key: "connected", header: "Connected" },
      ],
    );
    downloadBlob(
      new Blob([csv], { type: "text/csv" }),
      `switch-ports-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const chip = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm ${active ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search switch, port, VLAN, or client…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-sm"
        />
        <select
          value={sw}
          onChange={(e) => setSw(e.target.value)}
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
        >
          <option value="all">All switches</option>
          {switches.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <DeviceTypeChips value={devType} onChange={setDevType} counts={typeCounts} />
        <div className="flex overflow-hidden rounded-md border">
          {(["all", "up", "down"] as const).map((l) => (
            <button key={l} onClick={() => setLink(l)} className={chip(link === l)}>
              {l === "all" ? "All" : l === "up" ? "Up" : "Down"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={poeOnly} onChange={(e) => setPoeOnly(e.target.checked)} />
          PoE only
        </label>
        {ignoredSwitchCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showIgnored}
              onChange={(e) => setShowIgnored(e.target.checked)}
            />
            Show ignored ({ignoredSwitchCount})
          </label>
        )}
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
          Export CSV
        </Button>
        <span className="text-sm text-muted-foreground">
          {filtered.length} of {baseRows.length}
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="Switch" k="switch" sort={sort} onToggle={toggle} />
            <SortableHead label="Port" k="port" sort={sort} onToggle={toggle} />
            <SortableHead label="Link" k="link" sort={sort} onToggle={toggle} />
            <SortableHead label="PoE" k="poe" sort={sort} onToggle={toggle} />
            <SortableHead label="VLANs" k="vlans" sort={sort} onToggle={toggle} />
            <SortableHead label="Connected" k="connected" sort={sort} onToggle={toggle} />
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow key={`${r.switchMac}-${r.portIdx}`}>
              <TableCell className="text-sm">
                {r.switchName}
                {r.ignored && (
                  <span
                    className="ml-1.5 rounded bg-muted px-1.5 text-[10px] text-muted-foreground"
                    title={r.ignoredTitle ?? undefined}
                  >
                    ignored{r.ignoredSince ? ` since ${r.ignoredSince}` : ""}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-sm">
                {r.portIdx}
                {r.portName ? ` — ${r.portName}` : ""}
              </TableCell>
              <TableCell>
                {r.up ? (
                  <span className="text-green-600 dark:text-green-400 text-xs">
                    ● {r.speed ? (r.speed >= 1000 ? `${r.speed / 1000} GbE` : `${r.speed} Mb`) : "up"}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">○ down</span>
                )}
              </TableCell>
              <TableCell className="text-xs">
                {r.poeWatts && r.poeWatts > 0 ? `${r.poeWatts.toFixed(1)} W` : "-"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.vlanSummary}</TableCell>
              <TableCell className="text-xs">
                {r.connected.length === 0 ? (
                  <span className="text-muted-foreground">-</span>
                ) : (
                  <div className="space-y-0.5">
                    {r.connected.map((c, i) => (
                      <div key={`${c.mac}-${i}`} className="flex flex-wrap items-baseline gap-x-1.5">
                        {c.kind === "client" ? (
                          <ClientLink mac={c.mac} hint={c.name}>
                            {c.name}
                          </ClientLink>
                        ) : (
                          <span className="font-medium">{c.name}</span>
                        )}
                        {c.note && (
                          <span className="rounded bg-sky-100 px-1 py-px text-[10px] font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
                            {c.note}
                          </span>
                        )}
                        <span className="font-mono text-muted-foreground">{c.mac}</span>
                        <RandomMacBadge mac={c.mac} />
                      </div>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right">
                {canCapture && (
                  <PcapButton
                    mac={r.switchMac}
                    name={r.switchName}
                    portIdx={r.portIdx}
                    portName={r.portName}
                  />
                )}
              </TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No ports match
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
