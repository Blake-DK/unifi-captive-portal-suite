import { loadClients } from "@/lib/clientRows";
import { ClientsTable } from "@/components/admin/ClientsTable";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Rogue-extender identifier: the same detection that flags clients on the main
 * list and drives the alert rule, but here as a focused view — only the
 * suspected/possible consumer extenders and mesh nodes, so an operator hunting
 * unsanctioned WiFi gear sees just those. Reuses the shared client-row build
 * (flagged rows are clickable → detail window, blockable inline).
 */
export default async function ExtendersPage() {
  const { stations, rows, error } = await loadClients();

  const flagged = rows
    .filter((r) => r.flag !== null)
    .sort((a, b) =>
      a.flag!.confidence === b.flag!.confidence ? 0 : a.flag!.confidence === "high" ? -1 : 1,
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Range extenders</h1>
        <p className="text-sm text-muted-foreground">
          Connected clients that look like consumer WiFi range extenders or mesh nodes — detected
          by hostname/alias pattern (high confidence) or a known extender/mesh MAC OUI (possible).
          Click a row to see its history, or block it inline.
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      {flagged.length === 0 && !error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No suspected extenders among the {stations.length} connected client
            {stations.length !== 1 ? "s" : ""}.
          </CardContent>
        </Card>
      ) : (
        <ClientsTable rows={flagged} />
      )}
    </div>
  );
}
