import { Card, CardContent } from "@/components/ui/card";
import { PortForwardsTable } from "@/components/admin/PortForwardsTable";
import { loadPortForwards } from "@/lib/portForwards";
import { getAdminSession } from "@/lib/adminSession";

export const dynamic = "force-dynamic";

/**
 * UPnP Inspector: every way the LAN is reachable from the internet in one
 * place — admin-configured static port-forwards plus the dynamic UPnP/IGD
 * leases clients open for themselves — grouped by the device each targets.
 * loadPortForwards() never throws; the controller-error path renders a banner.
 */
export default async function UpnpPage() {
  const session = await getAdminSession();
  const canEdit = session?.role === "admin";
  const { groups, total, upnpAvailable, upnpCount, error } = await loadPortForwards();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Port Forwards & UPnP</h1>
        <p className="text-sm text-muted-foreground">
          Everything exposing the LAN to the internet: static port-forwards from UniFi{" "}
          <code>/rest/portforward</code> and dynamic UPnP leases devices open themselves, grouped by
          the device each points at. A <span className="text-destructive">source of any</span> means
          the whole internet can reach it. Add notes so an unexplained forward can&apos;t hide.
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      {!error && (
        <p className="text-xs text-muted-foreground">
          {total} mapping{total !== 1 ? "s" : ""} across {groups.length} device
          {groups.length !== 1 ? "s" : ""}.{" "}
          {upnpAvailable
            ? `${upnpCount} dynamic UPnP lease${upnpCount !== 1 ? "s" : ""} included.`
            : "Dynamic UPnP mappings aren’t exposed by this controller — static forwards only."}
        </p>
      )}

      {!error && <PortForwardsTable groups={groups} canEdit={canEdit} />}
    </div>
  );
}
