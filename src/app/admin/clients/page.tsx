import { loadClients } from "@/lib/clientRows";
import { BlockDeviceButton } from "@/components/admin/BlockDeviceButton";
import { ClientsTable } from "@/components/admin/ClientsTable";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SortableTable } from "@/components/admin/SortableTable";
import { RandomMacBadge } from "@/components/admin/RandomMacBadge";
import { ClientLink } from "@/components/admin/ClientWindows";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const { rows, blockedByMac, error } = await loadClients();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Clients</h1>
        <p className="text-sm text-muted-foreground">
          Every device connected right now (wired + wireless) from UniFi <code>/stat/sta</code>,
          flagged for likely consumer WiFi extenders/mesh nodes.
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* Blocked clients disconnect, so they vanish from the stations list —
          this card is the only place a fully-blocked device can be unblocked. */}
      {blockedByMac.size > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {blockedByMac.size} blocked device{blockedByMac.size !== 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SortableTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>MAC</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Blocked by</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...blockedByMac.entries()].map(([mac, b]) => (
                  <TableRow key={mac}>
                    <TableCell className="font-mono text-xs">
                      <ClientLink mac={mac}>{mac}</ClientLink>
                      <RandomMacBadge mac={mac} className="ml-1.5" />
                    </TableCell>
                    <TableCell className="text-sm">{b.reason}</TableCell>
                    <TableCell className="text-sm">{b.blockedBy}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {b.blockedAt.toLocaleString("en-GB")}
                    </TableCell>
                    <TableCell className="text-right">
                      <BlockDeviceButton mac={mac} blocked={b} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </SortableTable>
          </CardContent>
        </Card>
      )}

      <ClientsTable rows={rows} />
    </div>
  );
}
