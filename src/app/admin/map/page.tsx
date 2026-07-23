import { getSiteHealth, listControllerEvents, listDevices, listStations } from "@/lib/unifi";
import { buildTopology } from "@/lib/topology";
import { collectIssues, groupIssuesByDevice } from "@/lib/issues";
import { NetworkMap, type MapIssues, type MapView } from "@/components/admin/NetworkMap";
import { Card, CardContent } from "@/components/ui/card";
import { getAdminSession } from "@/lib/adminSession";
import { applyDeviceIgnores } from "@/lib/ignoredDevices";
import { prisma } from "@/lib/prisma";

/** Building/location maps from Settings → Locations: one per building line
 * plus an all-buildings map per location. A device belongs to a building when
 * its leading name token (the `<bldg>` part of the naming convention) equals
 * one of the words of the building line, so "Main Office 552" catches
 * "552-F3-AP-1". */
async function loadMapViews(): Promise<MapView[]> {
  const locations = await prisma.location
    .findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, buildings: true } })
    .catch(() => []);
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const views: MapView[] = [];
  for (const loc of locations) {
    const lines = loc.buildings
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      // Numeric-aware order (12 before 552 before 1221) regardless of how
      // the operator typed the list into the Locations tab.
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (lines.length === 0) continue;
    const all = new Set<string>();
    const perBuilding = lines.map((line) => {
      const tokens = words(line);
      tokens.forEach((t) => all.add(t));
      return { id: `loc${loc.id}:${line}`, label: line, group: loc.name, tokens };
    });
    if (lines.length > 1) {
      views.push({ id: `loc${loc.id}`, label: `${loc.name} (all buildings)`, group: loc.name, tokens: [...all] });
    }
    views.push(...perBuilding);
  }
  return views;
}

export const dynamic = "force-dynamic";

const EVENT_WINDOW_HOURS = 24;

export default async function MapPage() {
  const session = await getAdminSession();
  // Hardware control (restart / power-cycle / locate) is a full-admin action.
  const canControl = session?.role === "admin" || session?.sub === "setup";
  // Ignoring an offline device is a day-to-day call, not a hardware action.
  const canIgnore = canControl || session?.role === "operator";
  let error: string | null = null;
  let topology = null;
  let ignoredCount = 0;
  // Plain objects (not Maps) — these cross the server->client boundary.
  const mapIssues: MapIssues = { byDevice: {}, flapsByPort: {} };
  try {
    const [allDevices, stations, rawHealth, events] = await Promise.all([
      listDevices(),
      listStations().catch(() => []),
      getSiteHealth().catch(() => []),
      listControllerEvents(EVENT_WINDOW_HOURS).catch(() => []),
    ]);
    // Site-wide ignores (offline-on-purpose hardware) drop out of the map, its
    // counts, the health numbers and the issue badges — the same set the
    // alerts skip. The sweep also lifts ignores for anything back online.
    const { devices, health, ignored } = await applyDeviceIgnores(allDevices, rawHealth);
    ignoredCount = ignored.length;
    topology = buildTopology(devices, stations);
    const { issues, flaps } = collectIssues({ health, devices, stations, events, eventWindowHours: EVENT_WINDOW_HOURS });
    mapIssues.byDevice = groupIssuesByDevice(issues);
    for (const f of flaps) {
      if (f.portIdx === undefined) continue;
      mapIssues.flapsByPort[`${f.deviceMac}:${f.portIdx}`] = f.transitions;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Error querying UniFi";
  }

  const mapViews = await loadMapViews();
  const issueCount = Object.values(mapIssues.byDevice).reduce((n, list) => n + list.length, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Network Map</h1>
        <p className="text-sm text-muted-foreground">
          Physical topology from the UniFi controller — every device nested under the switch or
          gateway it uplinks through, with live issues and flapping links (last {EVENT_WINDOW_HOURS}h)
          marked where they are. Click a device for details.
          {topology && ` ${topology.online}/${topology.totalDevices} online${issueCount ? `, ${issueCount} issue${issueCount !== 1 ? "s" : ""}` : ""}.`}
          {ignoredCount > 0 &&
            ` ${ignoredCount} offline device${ignoredCount !== 1 ? "s are" : " is"} ignored site-wide (they return automatically when they come back online).`}
          {mapViews.length > 0 &&
            " Pick a building map to see one building's devices plus their uplink path to the core."}
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      {topology && topology.roots.length > 0 && (
        <NetworkMap
          topology={topology}
          canControl={canControl}
          issues={mapIssues}
          canIgnore={canIgnore}
          mapViews={mapViews}
        />
      )}

      {topology && topology.roots.length === 0 && !error && (
        <Card>
          <CardContent className="pt-6 text-muted-foreground">No devices reported.</CardContent>
        </Card>
      )}
    </div>
  );
}
