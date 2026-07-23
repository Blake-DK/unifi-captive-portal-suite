"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
import { BlockDeviceButton, type BlockInfo } from "@/components/admin/BlockDeviceButton";
import { ThrottleButton, type ThrottleInfo } from "@/components/admin/ThrottleButton";
import { ClientLink } from "@/components/admin/ClientWindows";
import { SortableHead, useTableSort, type SortAccessors } from "@/components/admin/tableSort";
import { isLocallyAdministeredMac } from "@/lib/mac";
import { RandomMacBadge } from "@/components/admin/RandomMacBadge";
import { Button } from "@/components/ui/button";
import { toCSV } from "@/lib/csv";
import { downloadBlob } from "@/lib/utils";

export type ClientRow = {
  mac: string;
  owner: { name: string; phone: string } | null;
  hostname: string;
  wired: boolean;
  ip: string;
  ssid: string;
  apOrSwitch: string;
  vlanNetwork: string;
  rx: string;
  tx: string;
  flag: { confidence: "high" | "low"; reason: string; vendor: string | null } | null;
  blocked: BlockInfo | null;
  throttled: ThrottleInfo | null;
};

function ExtenderBadge({ flag }: { flag: ClientRow["flag"] }) {
  if (!flag) return null;
  if (flag.confidence === "high") {
    return (
      <span
        title={flag.reason}
        className="rounded bg-rose-100 dark:bg-rose-900/40 px-1.5 py-0.5 text-[10px] font-medium text-rose-800 dark:text-rose-300"
      >
        Suspected extender
      </span>
    );
  }
  return (
    <span
      title={flag.reason}
      className="rounded bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-300"
    >
      Possible extender{flag.vendor ? ` (${flag.vendor})` : ""}
    </span>
  );
}

const SORTS: SortAccessors<ClientRow> = {
  owner: (r) => r.owner?.name ?? "",
  mac: (r) => r.mac,
  hostname: (r) => r.hostname,
  type: (r) => (r.wired ? "Wired" : "Wireless"),
  ip: (r) => r.ip,
  ssid: (r) => r.ssid,
  apOrSwitch: (r) => r.apOrSwitch,
  vlanNetwork: (r) => r.vlanNetwork,
  rx: (r) => r.rx,
  tx: (r) => r.tx,
  flag: (r) =>
    [r.flag ? `${r.flag.confidence} extender` : "", isLocallyAdministeredMac(r.mac) ? "randomised" : ""]
      .filter(Boolean)
      .join(" "),
};

export function ClientsTable({ rows }: { rows: ClientRow[] }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | "wired" | "wireless">("all");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [randomOnly, setRandomOnly] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (kind === "all" || (kind === "wired") === r.wired) &&
        (!flaggedOnly || r.flag !== null) &&
        (!randomOnly || isLocallyAdministeredMac(r.mac)) &&
        (!needle ||
          [r.mac, r.hostname, r.ip, r.ssid, r.apOrSwitch, r.vlanNetwork, r.owner?.name]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(needle))),
    );
  }, [rows, q, kind, flaggedOnly, randomOnly]);
  const { sorted, sort, toggle } = useTableSort(filtered, SORTS);

  const exportCsv = () => {
    const csv = toCSV(
      filtered.map((r) => ({
        owner: r.owner?.name ?? "",
        phone: r.owner?.phone ?? "",
        mac: r.mac,
        hostname: r.hostname,
        type: r.wired ? "wired" : "wireless",
        ip: r.ip,
        ssid: r.ssid,
        apOrSwitch: r.apOrSwitch,
        vlanNetwork: r.vlanNetwork,
        rx: r.rx,
        tx: r.tx,
        flag: r.flag ? `${r.flag.confidence} extender` : "",
        randomisedMac: isLocallyAdministeredMac(r.mac) ? "yes" : "",
        blocked: r.blocked ? "yes" : "",
        throttled: r.throttled ? `${r.throttled.downKbps}/${r.throttled.upKbps} Kbps` : "",
      })),
      [
        { key: "owner", header: "Owner" },
        { key: "phone", header: "Phone" },
        { key: "mac", header: "MAC" },
        { key: "hostname", header: "Hostname" },
        { key: "type", header: "Type" },
        { key: "ip", header: "IP" },
        { key: "ssid", header: "SSID" },
        { key: "apOrSwitch", header: "AP / Switch" },
        { key: "vlanNetwork", header: "VLAN / Network" },
        { key: "rx", header: "RX" },
        { key: "tx", header: "TX" },
        { key: "flag", header: "Flag" },
        { key: "randomisedMac", header: "Randomised MAC" },
        { key: "blocked", header: "Blocked" },
        { key: "throttled", header: "Throttled" },
      ],
    );
    downloadBlob(
      new Blob([csv], { type: "text/csv" }),
      `clients-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const suspectCount = rows.filter((r) => r.flag?.confidence === "high").length;
  const randomCount = rows.filter((r) => isLocallyAdministeredMac(r.mac)).length;
  const chip = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm ${active ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {rows.length} client{rows.length !== 1 ? "s" : ""}
          {suspectCount > 0 && (
            <span className="ml-2 font-normal text-muted-foreground">
              — {suspectCount} suspected extender{suspectCount !== 1 ? "s" : ""}
            </span>
          )}
          {randomCount > 0 && (
            <span className="ml-2 font-normal text-muted-foreground">
              — {randomCount} randomised MAC{randomCount !== 1 ? "s" : ""}
            </span>
          )}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Input
            placeholder="Search MAC, hostname, IP, SSID, owner…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />
          <div className="flex overflow-hidden rounded-md border">
            {(["all", "wireless", "wired"] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)} className={chip(kind === k)}>
                {k === "all" ? "All" : k === "wired" ? "Wired" : "Wireless"}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            Export CSV
          </Button>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
            Flagged only
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={randomOnly} onChange={(e) => setRandomOnly(e.target.checked)} />
            Randomised MACs only
          </label>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Owner" k="owner" sort={sort} onToggle={toggle} />
              <SortableHead label="MAC" k="mac" sort={sort} onToggle={toggle} />
              <SortableHead label="Hostname" k="hostname" sort={sort} onToggle={toggle} />
              <SortableHead label="Type" k="type" sort={sort} onToggle={toggle} />
              <SortableHead label="IP" k="ip" sort={sort} onToggle={toggle} />
              <SortableHead label="SSID" k="ssid" sort={sort} onToggle={toggle} />
              <SortableHead label="AP / Switch" k="apOrSwitch" sort={sort} onToggle={toggle} />
              <SortableHead label="VLAN / Network" k="vlanNetwork" sort={sort} onToggle={toggle} />
              <SortableHead label="↓ RX" k="rx" sort={sort} onToggle={toggle} />
              <SortableHead label="↑ TX" k="tx" sort={sort} onToggle={toggle} />
              <SortableHead label="Flag" k="flag" sort={sort} onToggle={toggle} />
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.mac}>
                <TableCell className="font-medium">
                  {r.owner ? (
                    <Link href={`/admin/users/${encodeURIComponent(r.owner.phone)}`} className="hover:underline">
                      {r.owner.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">unknown</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <ClientLink mac={r.mac} hint={r.hostname}>
                    {r.mac}
                  </ClientLink>
                </TableCell>
                <TableCell className="text-xs">
                  <ClientLink mac={r.mac} hint={r.hostname}>
                    {r.hostname}
                  </ClientLink>
                </TableCell>
                <TableCell className="text-xs">{r.wired ? "Wired" : "Wireless"}</TableCell>
                <TableCell className="font-mono text-xs">{r.ip}</TableCell>
                <TableCell>{r.ssid}</TableCell>
                <TableCell className="text-xs">{r.apOrSwitch}</TableCell>
                <TableCell className="text-xs">{r.vlanNetwork}</TableCell>
                <TableCell>{r.rx}</TableCell>
                <TableCell>{r.tx}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    <ExtenderBadge flag={r.flag} />
                    <RandomMacBadge mac={r.mac} />
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <ThrottleButton mac={r.mac} throttled={r.throttled} />
                    <BlockDeviceButton mac={r.mac} blocked={r.blocked} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground">
                  {rows.length === 0 ? "No devices online" : "Nothing matches the filter"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
