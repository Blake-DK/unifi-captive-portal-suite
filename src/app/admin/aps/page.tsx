import { getSiteHealth, listControllerEvents, listDevices, listStations } from "@/lib/unifi";
import { collectIssues, groupIssuesByDevice } from "@/lib/issues";
import { RADIO_LABEL, agoLabel, formatUptime } from "@/lib/deviceLabels";
import { deviceNodes } from "@/lib/topology";
import { applyDeviceIgnores } from "@/lib/ignoredDevices";
import { getAdminSession } from "@/lib/adminSession";
import { Card, CardContent } from "@/components/ui/card";
import { ApTable, type ApRow } from "@/components/admin/ApTable";

export const dynamic = "force-dynamic";

const EVENT_WINDOW_HOURS = 24;

export default async function ApsPage() {
  const session = await getAdminSession();
  // Same split as Network Status: hardware control is full-admin, ignoring
  // an offline device is a day-to-day operator call.
  const canControl = session?.role === "admin" || session?.sub === "setup";
  const canIgnore = canControl || session?.role === "operator";
  let error: string | null = null;
  let rows: ApRow[] = [];

  try {
    const [allDevices, stations, rawHealth, events] = await Promise.all([
      listDevices(),
      listStations().catch(() => []),
      getSiteHealth().catch(() => []),
      listControllerEvents(EVENT_WINDOW_HOURS).catch(() => []),
    ]);
    // Site-wide offline ignores: issues are computed over the visible fleet
    // (an ignored AP raises none), but rows are only MARKED, not dropped, so
    // the table can toggle them back into view without a reload.
    const { devices: visibleDevices, health, ignoredMacs, ignores } = await applyDeviceIgnores(allDevices, rawHealth);
    const { issues } = collectIssues({ health, devices: visibleDevices, stations, events, eventWindowHours: EVENT_WINDOW_HOURS });
    const issuesByMac = groupIssuesByDevice(issues);
    // The same per-device node the map and Network Status hand their dialog.
    const nodeByMac = new Map(deviceNodes(allDevices, stations).map((n) => [n.mac.toLowerCase(), n]));

    rows = allDevices
      .filter((d) => d.type === "uap")
      .map((d) => {
        const mac = d.mac.toLowerCase();
        const ss = d["system-stats"] ?? {};
        const ignoreRow = ignores.get(mac);
        return {
          node: nodeByMac.get(mac)!,
          ignored: ignoredMacs.has(mac),
          ignoredSince: ignoreRow ? ignoreRow.createdAt.toLocaleDateString("en-GB") : null,
          ignoredTitle: ignoreRow
            ? `by ${ignoreRow.createdBy}${ignoreRow.note ? `: ${ignoreRow.note}` : ""}`
            : null,
          mac: d.mac,
          name: d.name || d.mac,
          model: d.model ?? "-",
          online: d.state === 1,
          stateLabel: d.state === 1 ? "Online" : d.state === 0 ? "Offline" : "Transitional",
          lastSeen: d.state === 1 ? null : agoLabel(d.last_seen),
          version: d.version ?? "-",
          upgradable: Boolean(d.upgradable),
          uptime: formatUptime(d.uptime),
          clients: Number(d.num_sta) || 0,
          satisfaction: d.satisfaction ?? null,
          cpuPct: ss.cpu !== undefined ? Number(ss.cpu) : null,
          memPct: ss.mem !== undefined ? Number(ss.mem) : null,
          radios: (d.radio_table_stats ?? []).map((r) => ({
            band: RADIO_LABEL[r.radio ?? ""] ?? r.radio ?? "?",
            channel: r.channel ?? null,
            utilizationPct: r.cu_total ?? null,
            clients: r.num_sta ?? null,
          })),
          issues: issuesByMac[mac] ?? [],
        };
      })
      .sort((a, b) => b.issues.length - a.issues.length || a.name.localeCompare(b.name));
  } catch (err) {
    error = err instanceof Error ? err.message : "Error querying UniFi";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Access Points</h1>
        <p className="text-sm text-muted-foreground">
          Every AP with radios, channel utilization, client load, and its live issues (including
          weak-signal clients associated to it) — problem APs sort to the top.
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      <ApTable rows={rows} canControl={canControl} canIgnore={canIgnore} />
    </div>
  );
}
