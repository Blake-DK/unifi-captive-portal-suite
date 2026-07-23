"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SortableHead, useTableSort, type SortAccessors } from "@/components/admin/tableSort";
import { useDeviceWindows } from "@/components/admin/DeviceWindows";
import { useClientWindows } from "@/components/admin/ClientWindows";
import { RandomMacBadge } from "@/components/admin/RandomMacBadge";
import { RogueSignalMap } from "@/components/admin/RogueSignalMap";
import { isLocallyAdministeredMac } from "@/lib/mac";

export type RogueSighting = { apMac: string; apName: string; rssi: number };

export type RogueCandidateRow = {
  mac: string;
  name: string;
  ip: string | null;
  vendor: string;
  where: string | null; // "via AP-Lobby" / "sw port 12" / null
  reason: string;
  confidence: "high" | "low";
};

export type RogueRow = {
  bssid: string;
  ssid: string; // "" = hidden
  security: string;
  channel?: number;
  radio?: string;
  signal?: number; // strongest sighting, for sorting/display
  oui?: string;
  spoofing: boolean;
  open: boolean; // spoof with no encryption
  ageMin?: number;
  sightings: RogueSighting[]; // strongest first
  candidates: RogueCandidateRow[];
};

const SORTS: SortAccessors<RogueRow> = {
  ssid: (r) => r.ssid,
  bssid: (r) => r.bssid,
  security: (r) => r.security || "open",
  channel: (r) => r.channel,
  signal: (r) => r.signal,
  vendor: (r) => r.oui ?? "",
  seenBy: (r) => r.sightings[0]?.apName ?? "",
  age: (r) => r.ageMin,
  flag: (r) => (r.spoofing ? (r.open ? 2 : 1) : 0),
};

export function RogueApTable({ rows }: { rows: RogueRow[]; canControl?: boolean; canIgnore?: boolean }) {
  const [q, setQ] = useState("");
  const [spoofOnly, setSpoofOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { open: openDevice } = useDeviceWindows();
  const { open: openClient } = useClientWindows();

  const spoofCount = rows.filter((r) => r.spoofing).length;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!spoofOnly || r.spoofing) &&
        (!needle ||
          [r.ssid, r.bssid, r.oui, r.security, ...r.sightings.map((s) => s.apName)]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(needle))),
    );
  }, [rows, q, spoofOnly]);
  const { sorted, sort, toggle } = useTableSort(filtered, SORTS);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {rows.length} neighbouring AP{rows.length !== 1 ? "s" : ""}
          {spoofCount > 0 && (
            <span className="ml-2 font-normal text-destructive">
              — {spoofCount} impersonating your SSID{spoofCount !== 1 ? "s" : ""}
            </span>
          )}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Input
            placeholder="Search SSID, BSSID, vendor, AP…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={spoofOnly} onChange={(e) => setSpoofOnly(e.target.checked)} />
            Spoofing our SSID only
          </label>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <SortableHead label="SSID" k="ssid" sort={sort} onToggle={toggle} />
              <SortableHead label="BSSID" k="bssid" sort={sort} onToggle={toggle} />
              <SortableHead label="Security" k="security" sort={sort} onToggle={toggle} />
              <SortableHead label="Ch" k="channel" sort={sort} onToggle={toggle} />
              <SortableHead label="Signal" k="signal" sort={sort} onToggle={toggle} />
              <SortableHead label="Vendor" k="vendor" sort={sort} onToggle={toggle} />
              <SortableHead label="Nearest AP" k="seenBy" sort={sort} onToggle={toggle} />
              <SortableHead label="Age" k="age" sort={sort} onToggle={toggle} />
              <SortableHead label="Flag" k="flag" sort={sort} onToggle={toggle} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => {
              const nearest = r.sightings[0];
              const isOpen = expanded === r.bssid;
              return (
                <Fragment key={r.bssid}>
                  <TableRow
                    className={`cursor-pointer ${r.spoofing ? "bg-rose-50 dark:bg-rose-950/30" : ""}`}
                    onClick={() => setExpanded((e) => (e === r.bssid ? null : r.bssid))}
                  >
                    <TableCell className="text-muted-foreground">
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </TableCell>
                    <TableCell className="font-medium">
                      {r.ssid || <span className="text-muted-foreground">(hidden)</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.bssid}</TableCell>
                    <TableCell className="text-xs">{r.security || "open"}</TableCell>
                    <TableCell className="text-xs">{r.channel ?? "-"}</TableCell>
                    <TableCell className="text-xs">
                      {r.signal != null ? `${r.signal} dBm` : "-"}
                      {r.sightings.length > 1 && (
                        <span className="text-muted-foreground"> · {r.sightings.length} APs</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{r.oui ?? "-"}</TableCell>
                    <TableCell className="text-xs">
                      {nearest ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDevice(nearest.apMac, nearest.apName);
                          }}
                          title="Open this AP (facts, connected clients, tools)"
                          className="hover:underline decoration-dotted underline-offset-2"
                        >
                          {nearest.apName}
                        </button>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.ageMin != null ? `${r.ageMin}m` : "-"}
                    </TableCell>
                    <TableCell>
                      {r.spoofing && (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            r.open ? "bg-red-600 text-white" : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"
                          }`}
                        >
                          {r.open ? "Evil twin (open)" : "Spoofing our SSID"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableCell colSpan={10} className="p-4">
                        <RogueLocatePanel row={r} onOpenAp={openDevice} onOpenClient={openClient} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground">
                  {rows.length === 0 ? "No neighbouring APs seen" : "Nothing matches the filter"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RogueLocatePanel({
  row,
  onOpenAp,
  onOpenClient,
}: {
  row: RogueRow;
  onOpenAp: (mac: string, hint?: string) => void;
  onOpenClient: (mac: string, hint?: string) => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Where is it?</p>
        {row.sightings.length === 0 ? (
          <p className="text-xs text-muted-foreground">No AP reported a signal for this BSSID, so it can&apos;t be located.</p>
        ) : (
          <RogueSignalMap ssid={row.ssid} bssid={row.bssid} sightings={row.sightings} onOpenAp={(mac) => onOpenAp(mac)} />
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Devices on your network that might be broadcasting it ({row.candidates.length})
        </p>
        {row.candidates.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No on-network device shares this BSSID&apos;s vendor block. If it is an evil twin it is likely standalone
            hardware nearby rather than something bridged onto your LAN.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="p-1.5">Device</th>
                  <th className="p-1.5">MAC</th>
                  <th className="p-1.5">Where</th>
                  <th className="p-1.5">Why</th>
                </tr>
              </thead>
              <tbody>
                {row.candidates.map((c) => (
                  <tr key={c.mac} className="border-t">
                    <td className="p-1.5">
                      <button
                        type="button"
                        onClick={() => onOpenClient(c.mac, c.name || undefined)}
                        className="hover:underline decoration-dotted underline-offset-2"
                        title="Open this client"
                      >
                        {c.name || <span className="text-muted-foreground">unknown</span>}
                      </button>
                      <span className="ml-1 text-muted-foreground">{c.ip ?? ""}</span>
                    </td>
                    <td className="p-1.5 font-mono">
                      {c.mac}
                      {isLocallyAdministeredMac(c.mac) && <RandomMacBadge mac={c.mac} className="ml-1" />}
                    </td>
                    <td className="p-1.5 text-muted-foreground">{c.where ?? "-"}</td>
                    <td className="p-1.5">
                      <span
                        className={`mr-1.5 rounded px-1 py-0.5 text-[10px] font-medium ${
                          c.confidence === "high"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {c.confidence}
                      </span>
                      {c.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
