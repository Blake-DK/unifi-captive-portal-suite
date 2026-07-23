import Link from "next/link";
import { listAccessPoints, listActiveGuests, listNetworks, listStations } from "@/lib/unifi";
import { prisma } from "@/lib/prisma";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RevokeButton } from "@/components/admin/RevokeButton";
import { SortableTable } from "@/components/admin/SortableTable";
import { RandomMacBadge } from "@/components/admin/RandomMacBadge";
import { ClientLink } from "@/components/admin/ClientWindows";

export const dynamic = "force-dynamic";

function formatBytes(n?: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export default async function SessionsPage() {
  let guests: Awaited<ReturnType<typeof listActiveGuests>> = [];
  let error: string | null = null;
  const apName = new Map<string, string>();
  const stationByMac = new Map<string, Awaited<ReturnType<typeof listStations>>[number]>();
  const networkNameById = new Map<string, string>();
  try {
    guests = await listActiveGuests();
    for (const ap of await listAccessPoints().catch(() => [])) {
      if (ap.name) apName.set(ap.mac.toLowerCase(), ap.name);
    }
    // /stat/guest has no VLAN/network info — merge it in from /stat/sta.
    for (const sta of await listStations().catch(() => [])) {
      stationByMac.set(sta.mac.toLowerCase(), sta);
    }
    for (const net of await listNetworks().catch(() => [])) {
      networkNameById.set(net._id, net.name);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Error querying UniFi";
  }

  const macs = guests.map((g) => g.mac.toLowerCase());
  const registrations = await prisma.guestRegistration.findMany({
    where: { macAddress: { in: macs } },
    orderBy: { authorizedAt: "desc" },
  });
  const byMac = new Map(registrations.map((r) => [r.macAddress, r]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Active Sessions</h1>
        <p className="text-sm text-muted-foreground">
          Live data from UniFi <code>/stat/guest</code> matched against local records.
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{guests.length} session{guests.length !== 1 ? "s" : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          <SortableTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guest</TableHead>
                <TableHead>MAC</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>SSID</TableHead>
                <TableHead>AP</TableHead>
                <TableHead>VLAN</TableHead>
                <TableHead>Network</TableHead>
                <TableHead>↓ RX</TableHead>
                <TableHead>↑ TX</TableHead>
                <TableHead>Connected At</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {guests.map((g) => {
                const reg = byMac.get(g.mac.toLowerCase());
                const sta = stationByMac.get(g.mac.toLowerCase());
                const name = reg ? `${reg.firstName} ${reg.lastName}` : null;
                const ip = sta?.ip ?? g.ip;
                const network =
                  (sta?.network_id ? networkNameById.get(sta.network_id) : undefined) ??
                  sta?.network;
                return (
                  <TableRow key={g.mac}>
                    <TableCell className="font-medium">
                      {reg ? (
                        <Link
                          href={`/admin/users/${encodeURIComponent(reg.phone)}`}
                          className="hover:underline"
                        >
                          {name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">unknown</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <ClientLink mac={g.mac} hint={g.hostname}>{g.mac}</ClientLink>
                      <RandomMacBadge mac={g.mac} className="ml-1.5" />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{ip ?? "-"}</TableCell>
                    <TableCell>{g.essid ?? "-"}</TableCell>
                    <TableCell className="text-xs">
                      {g.ap_mac ? apName.get(g.ap_mac.toLowerCase()) ?? g.ap_mac : "-"}
                    </TableCell>
                    <TableCell>{sta?.vlan ?? "-"}</TableCell>
                    <TableCell>{network ?? "-"}</TableCell>
                    <TableCell>{formatBytes(g.rx_bytes)}</TableCell>
                    <TableCell>{formatBytes(g.tx_bytes)}</TableCell>
                    <TableCell>
                      {g.start ? new Date(g.start * 1000).toLocaleString("en-GB") : "-"}
                    </TableCell>
                    <TableCell>
                      <RevokeButton mac={g.mac} />
                    </TableCell>
                  </TableRow>
                );
              })}
              {guests.length === 0 && !error && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground">
                    No active sessions
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </SortableTable>
        </CardContent>
      </Card>
    </div>
  );
}
