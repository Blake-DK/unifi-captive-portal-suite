import { listDevices, listNetworks, listStations } from "@/lib/unifi";
import { agoLabel } from "@/lib/deviceLabels";
import { applyDeviceIgnores } from "@/lib/ignoredDevices";
import { portVlanSummary, uplinkOf } from "@/lib/vlanTrace";
import { getAdminSession } from "@/lib/adminSession";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PortInventoryTable,
  type PortDevice,
  type PortRow,
} from "@/components/admin/PortInventoryTable";

export const dynamic = "force-dynamic";

// UniFi device.state → short status suffix; only a truly-offline device (0) is
// flagged offline. 4/5 are transient management states, not outages.
function deviceStatusNote(state?: number): string {
  switch (state) {
    case 1:
      return "";
    case 0:
      return " · offline";
    case 2:
      return " · pending";
    case 4:
      return " · upgrading";
    case 5:
      return " · provisioning";
    default:
      return "";
  }
}

function deviceKindLabel(type?: string): string {
  switch (type) {
    case "uap":
      return "AP";
    case "usw":
      return "Switch";
    case "ugw":
    case "udm":
    case "uxg":
      return "Gateway";
    case "uck":
      return "Cloud Key";
    case "cn":
      return "Core Node";
    case "ubb":
      return "Building Bridge";
    default:
      return "Device";
  }
}

export default async function PortsPage() {
  const session = await getAdminSession();
  const canCapture = session?.role === "admin" || session?.sub === "setup";
  let rows: PortRow[] = [];
  let error: string | null = null;

  try {
    const [devices, stations, networks] = await Promise.all([
      listDevices(),
      listStations().catch(() => []),
      listNetworks().catch(() => []),
    ]);
    const netName = (id?: string) => {
      const n = networks.find((x) => x._id === id);
      return n ? `${n.name}${n.vlan ? ` (VLAN ${n.vlan})` : ""}` : (id ?? "default");
    };
    // Ports of an ignored (offline-on-purpose) switch are stale last-known
    // data — hidden by default, toggled back in by the table (rows marked).
    const { ignoredMacs, ignores } = await applyDeviceIgnores(devices);
    // Everything plugged into each port: client stations (from /stat/sta) AND
    // adopted UniFi devices (APs, downstream switches, the gateway), which the
    // stations list never contains — they report their upstream switch+port via
    // their own uplink field instead. Multiple entries per port are real
    // (anything behind an unmanaged switch or extender), so keep a list.
    const connectedByPort = new Map<string, PortDevice[]>();
    const push = (swMac: string, port: number, entry: PortDevice) => {
      const key = `${swMac.toLowerCase()}-${port}`;
      const list = connectedByPort.get(key) ?? [];
      list.push(entry);
      connectedByPort.set(key, list);
    };
    for (const dev of devices) {
      const uplink = uplinkOf(dev);
      if (!uplink?.uplink_mac || uplink.uplink_remote_port == null) continue;
      const seen = dev.state === 0 ? agoLabel(dev.last_seen) : null;
      push(uplink.uplink_mac, uplink.uplink_remote_port, {
        name: dev.name || dev.mac,
        mac: dev.mac,
        kind: "device",
        note: `UniFi ${deviceKindLabel(dev.type)}${dev.model ? ` · ${dev.model}` : ""}${deviceStatusNote(dev.state)}${seen ? ` (last seen ${seen})` : ""}`,
      });
    }
    for (const sta of stations) {
      if (!sta.is_wired || !sta.sw_mac || sta.sw_port == null) continue;
      push(sta.sw_mac, sta.sw_port, {
        name: sta.name ?? sta.hostname ?? sta.mac,
        mac: sta.mac,
        kind: "client",
      });
    }

    const switches = devices.filter((d) => (d.port_table?.length ?? 0) > 0);
    for (const sw of switches) {
      const ignoreRow = ignores.get(sw.mac.toLowerCase());
      for (const p of sw.port_table ?? []) {
        if (p.port_idx == null) continue;
        rows.push({
          switchName: sw.name || sw.mac,
          switchMac: sw.mac,
          switchType: sw.type,
          ignored: ignoredMacs.has(sw.mac.toLowerCase()),
          ignoredSince: ignoreRow ? ignoreRow.createdAt.toLocaleDateString("en-GB") : null,
          ignoredTitle: ignoreRow
            ? `by ${ignoreRow.createdBy}${ignoreRow.note ? `: ${ignoreRow.note}` : ""}`
            : null,
          portIdx: p.port_idx,
          portName: p.name ?? "",
          up: Boolean(p.up),
          speed: p.speed,
          poeWatts: p.poe_power ? Number(p.poe_power) : undefined,
          vlanSummary: portVlanSummary(p, netName),
          connected: connectedByPort.get(`${sw.mac.toLowerCase()}-${p.port_idx}`) ?? [],
        });
      }
    }
    rows.sort((a, b) => a.switchName.localeCompare(b.switchName) || a.portIdx - b.portIdx);
  } catch (err) {
    error = err instanceof Error ? err.message : "Error querying UniFi";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Switch Ports</h1>
        <p className="text-sm text-muted-foreground">
          Flat inventory of every switch port across the site, with whatever is plugged in —
          clients and UniFi devices (APs, switches, gateway) alike.
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{rows.length} ports</CardTitle>
        </CardHeader>
        <CardContent>
          <PortInventoryTable rows={rows} canCapture={canCapture} />
        </CardContent>
      </Card>
    </div>
  );
}
