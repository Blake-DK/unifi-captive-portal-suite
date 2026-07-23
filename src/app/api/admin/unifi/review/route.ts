import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { getPortalConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import {
  detectFirewallEngine,
  getSiteHealth,
  listDevices,
  listNetworks,
  listSiteSettings,
  listWlans,
} from "@/lib/unifi";
import { reviewNetwork } from "@/lib/networkReview";
import { extractWanLinks } from "@/lib/wan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only network review: the data the Network Review tab needs — the list
 * of networks (for the firewall picker), the firewall engine + zones (so the
 * picker and plan speak zone-based natively on UniFi Network 9+), the
 * portal/reverse-proxy target IPs, and the computed stability
 * recommendations. Writes nothing to the controller; the plan preview is
 * built client-side from the picker selection (pure buildZbfPlan /
 * buildFirewallPlan) and applied only through the guarded apply endpoint.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const cfg = await getPortalConfig();

  // Portal target IP: the Proxy Target IP setting, else the host of the portal
  // base URL if it's an IP.
  const portalHost = (() => {
    if (cfg.portalTargetIp) return cfg.portalTargetIp;
    try {
      return new URL(cfg.portalBaseUrl).hostname;
    } catch {
      return "";
    }
  })();
  // With the bundled Traefik, the proxy shares the portal host (host ports
  // 80/443 in front of the portal) — same IP, wider ports. An external proxy
  // lives outside this stack; its firewalling is the operator's own policy.
  const proxyHost = cfg.reverseProxyMode === "bundled" ? portalHost : "";

  try {
    const [devices, networks, wlans, health, engine, siteSettings] = await Promise.all([
      listDevices(),
      listNetworks(),
      listWlans().catch(() => []),
      getSiteHealth().catch(() => []),
      detectFirewallEngine().catch(() => ({ zbfDetected: false, zones: [], probes: [] })),
      listSiteSettings().catch(() => []),
    ]);
    const wanIp = health.find((h) => h.subsystem === "www")?.wan_ip ?? null;
    const wanLinks = extractWanLinks(devices, wanIp, networks);

    const snmpConfigured = !!(await prisma.systemSettings.findUnique({ where: { id: "config" }, select: { snmpEnabled: true } }))?.snmpEnabled;
    const recommendations = reviewNetwork({ devices, networks, wlans, wanLinks, siteSettings, snmpConfigured });

    const zbf = engine.zbfDetected && engine.zones.length > 0;
    return NextResponse.json({
      portal: { name: "Portal", ip: portalHost },
      proxy: proxyHost ? { name: "Traefik", ip: proxyHost } : null,
      engine: zbf ? "zone-based" : engine.zbfDetected ? "zone-based (zones unresolved)" : "classic",
      // Zones drive the zone-native picker + plan; null keeps the page on the
      // classic table for pre-9 controllers (or when zones can't be listed).
      zones: zbf
        ? engine.zones.map((z) => ({ id: z._id, name: z.name ?? z._id, networkIds: z.network_ids ?? [] }))
        : null,
      // WAN networks are the uplink, not a LAN the portal can be reached
      // from — never a valid firewall source/target, so keep them out of the
      // picker entirely.
      networks: networks
        .filter((n) => !(n.purpose ?? "").startsWith("wan"))
        .map((n) => ({
          id: n._id,
          name: n.name,
          vlan: n.vlan,
          subnet: n.ip_subnet,
          isGuest: n.purpose === "guest",
          // Manual DHCP DNS entries — lets the zone planner keep DNS working
          // across guest isolation. Auto mode hands out the gateway (same
          // network), which the isolation blocks never touch.
          dnsServers:
            n.dhcpd_dns_enabled !== false
              ? [n.dhcpd_dns_1, n.dhcpd_dns_2, n.dhcpd_dns_3, n.dhcpd_dns_4].filter(
                  (d): d is string => !!d,
                )
              : [],
        })),
      recommendations,
      // Adopted devices for the path test's device pickers ("simulate from
      // this AP") — name + IP is all the client needs.
      devices: devices
        .filter((d) => d.ip)
        .map((d) => ({ mac: d.mac, name: d.name || d.mac, ip: d.ip!, type: d.type ?? "" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "UniFi request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
