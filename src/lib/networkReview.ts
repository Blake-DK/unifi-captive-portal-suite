import type { UniFiDeviceHealth, UniFiNetwork, UniFiSiteSetting, UniFiWlan } from "./unifi";
import type { WanLink } from "./wan";

/**
 * Network stability review — read-only recommendations derived from the
 * controller snapshot the app already fetches (devices, networks, WLANs,
 * gateway WAN state). Each rule is a pure check that returns a recommendation
 * only when the condition holds, so the tab shows a clean "nothing to
 * improve" when the network is healthy. Advisory only: it never changes the
 * controller. Kept pure/testable like the alert evaluators.
 *
 * Scope is deliberately limited to what the classic API reliably returns —
 * better to give a few trustworthy recommendations than a wall of guesses
 * about settings we can't see. New checks are cheap to add as more of the
 * `get/setting` sections get surfaced.
 */

export type Recommendation = {
  id: string;
  severity: "warning" | "info";
  title: string;
  detail: string;
};

export type ReviewInput = {
  devices: UniFiDeviceHealth[];
  networks: UniFiNetwork[];
  wlans: UniFiWlan[];
  /** Pre-computed by the caller (extractWanLinks) so this stays a pure input transform. */
  wanLinks?: WanLink[];
  /** Raw /rest/setting sections — enables the config-health checks below. */
  siteSettings?: UniFiSiteSetting[];
  /** Is the portal's own SNMP fallback poller turned on (Settings → Monitoring)? */
  snmpConfigured?: boolean;
};

export function reviewNetwork(input: ReviewInput): Recommendation[] {
  const out: Recommendation[] = [];
  const { devices, networks, wlans } = input;

  // Firmware consistency — a spread of versions across the fleet is a common
  // source of intermittent adoption/roaming bugs.
  const versions = new Set(
    devices.filter((d) => d.state === 1 && d.version).map((d) => d.version as string),
  );
  if (versions.size > 1) {
    out.push({
      id: "firmware-spread",
      severity: "warning",
      title: "Devices run mixed firmware versions",
      detail: `${versions.size} distinct firmware versions across online devices (${[...versions].join(", ")}). Align them — mismatched firmware is a frequent cause of roaming and adoption glitches.`,
    });
  }
  const upgradable = devices.filter((d) => d.state === 1 && d.upgradable);
  if (upgradable.length > 0) {
    out.push({
      id: "firmware-updates",
      severity: "info",
      title: `${upgradable.length} device(s) have a firmware update available`,
      detail: `${upgradable.map((d) => d.name || d.mac).slice(0, 8).join(", ")}. Update during a maintenance window to pick up stability fixes.`,
    });
  }

  // Multi-WAN redundancy: a gateway with a second WAN configured but down has
  // lost its failover headroom. WAN links are computed by the caller.
  const enabledWans = (input.wanLinks ?? []).filter((w) => w.enabled);
  if (enabledWans.length >= 2) {
    const down = enabledWans.filter((w) => !w.up);
    if (down.length > 0) {
      out.push({
        id: "wan-redundancy-degraded",
        severity: "warning",
        title: "WAN redundancy is degraded",
        detail: `${down.map((w) => w.name).join(", ")} down — the site has no failover headroom until it recovers.`,
      });
    }
  }

  // DHCP pool headroom on guest networks — a range that's too small for the
  // expected guest count causes "connected but no IP" failures the portal
  // can't fix.
  for (const net of networks) {
    if (!net.dhcpd_enabled || !net.dhcpd_start || !net.dhcpd_stop) continue;
    const size = poolSize(net.dhcpd_start, net.dhcpd_stop);
    if (size != null && size < 64 && (net.purpose === "guest" || /guest/i.test(net.name))) {
      out.push({
        id: `dhcp-small-${net._id}`,
        severity: "info",
        title: `Guest DHCP pool on "${net.name}" is small (${size} addresses)`,
        detail: "A busy guest SSID can exhaust a small pool, leaving clients connected without an IP. Widen the range if guest counts approach it.",
      });
    }
  }

  // Guest SSID hygiene: a WLAN flagged is_guest should land on a network with
  // the "guest" purpose (so isolation applies); flag a guest SSID pointed at a
  // corporate network.
  const guestNetworkIds = new Set(networks.filter((n) => n.purpose === "guest").map((n) => n._id));
  for (const w of wlans) {
    if (w.is_guest && w.networkconf_id && !guestNetworkIds.has(w.networkconf_id)) {
      const net = networks.find((n) => n._id === w.networkconf_id);
      out.push({
        id: `guest-ssid-nonguest-net-${w._id}`,
        severity: "warning",
        title: `Guest SSID "${w.name}" is on a non-guest network`,
        detail: `"${w.name}" has the guest policy but lands on ${net?.name ?? "a corporate network"}, which doesn't apply client isolation. Move it to a network with the Guest purpose so guests can't reach each other or the LAN.`,
      });
    }
  }

  // Offline/adoption trouble surfaced as a stability item (distinct from the
  // real-time alert — this is the "review your network" framing).
  const notConnected = devices.filter((d) => d.state !== undefined && d.state !== 1);
  if (notConnected.length > 0) {
    out.push({
      id: "devices-not-connected",
      severity: "warning",
      title: `${notConnected.length} device(s) are not fully connected`,
      detail: `${notConnected.map((d) => d.name || d.mac).slice(0, 8).join(", ")}. Adoption/heartbeat trouble here undermines coverage and roaming.`,
    });
  }

  // --- Config health / best practices (needs the WLAN security fields and
  // the /rest/setting sections; every check degrades to silence when the
  // controller doesn't expose its inputs — no guesses).

  const activeWlans = wlans.filter((w) => w.enabled !== false);

  const openNonGuest = activeWlans.filter((w) => w.security === "open" && !w.is_guest);
  if (openNonGuest.length > 0) {
    out.push({
      id: "wlan-open-nonguest",
      severity: "warning",
      title: `Open (unencrypted) SSID${openNonGuest.length > 1 ? "s" : ""} without guest policy: ${openNonGuest.map((w) => w.name).join(", ")}`,
      detail: "An open SSID that is not a guest network exposes the LAN to anyone in radio range, unencrypted. Add WPA2/WPA3, or mark it as a guest SSID on an isolated guest network.",
    });
  }

  const wpa1 = activeWlans.filter((w) => (w.wpa_mode ?? "").toLowerCase() === "wpa1");
  if (wpa1.length > 0) {
    out.push({
      id: "wlan-wpa1",
      severity: "warning",
      title: `WPA1 security on ${wpa1.map((w) => w.name).join(", ")}`,
      detail: "WPA(1)/TKIP is broken and drags the radio into legacy compatibility modes. Move to WPA2 at minimum; WPA3 (or WPA2/WPA3 transitional) where clients allow.",
    });
  }

  const pmfOff = activeWlans.filter((w) => w.pmf_mode === "disabled" && w.security !== "open");
  if (pmfOff.length > 0) {
    out.push({
      id: "wlan-pmf-disabled",
      severity: "info",
      title: `Protected Management Frames disabled on ${pmfOff.map((w) => w.name).join(", ")}`,
      detail: "PMF (802.11w) stops deauth/disassoc spoofing. “Optional” keeps old clients working while protecting capable ones — worth enabling unless a legacy device proves otherwise.",
    });
  }

  const section = (key: string) => input.siteSettings?.find((s) => s.key === key);

  const usg = section("usg");
  if (usg?.upnp_enabled === true) {
    out.push({
      id: "usg-upnp",
      severity: "warning",
      title: "UPnP is enabled on the gateway",
      detail: "UPnP lets any LAN device open inbound ports without review — a common lateral-movement and exposure vector. Disable it and forward the few ports you actually need explicitly.",
    });
  }

  const ips = section("ips");
  if (ips && (ips.ips_mode === undefined || ips.ips_mode === "disabled")) {
    out.push({
      id: "ips-disabled",
      severity: "info",
      title: "Threat detection (IDS/IPS) is off",
      detail: "The gateway can inspect traffic for known attack signatures. IDS (detect-only) costs little and surfaces problems early; enable IPS if the throughput hit is acceptable.",
    });
  }

  const mgmt = section("mgmt");
  if (mgmt && mgmt.auto_upgrade !== true) {
    out.push({
      id: "mgmt-auto-upgrade-off",
      severity: "info",
      title: "Automatic device firmware upgrades are off",
      detail: "Fleet firmware drifts apart without it (see the mixed-versions check). If change control forbids auto-upgrade, schedule a recurring manual window instead.",
    });
  }

  // SNMP config health — the portal's own SNMPv3 fallback poller (Settings ->
  // Monitoring) is a distinct concern from what the controller exposes here.
  const snmpSection = section("snmp");
  if (snmpSection?.enabled === true && !!snmpSection.community) {
    out.push({
      id: "snmp-v2c-enabled",
      severity: "warning",
      title: "SNMP v1/v2c (community string) is enabled on the controller",
      detail: "Community-string SNMP authenticates in plaintext. If SNMP fallback polling is wanted, use SNMPv3 authPriv instead (controller Settings → System → SNMP, then portal Settings → Monitoring) and turn off the v1/v2c community.",
    });
  }
  if (input.snmpConfigured && snmpSection && snmpSection.enabled !== true) {
    out.push({
      id: "snmp-fallback-unconfigured-on-controller",
      severity: "warning",
      title: "SNMP fallback is enabled in the portal, but SNMP looks disabled on the controller",
      detail: "The portal's SNMP fallback poller (Settings → Monitoring) has nothing to poll unless SNMP is turned on for the site (controller Settings → System → SNMP, SNMPv3 authPriv).",
    });
  }

  // Flat network: everything in one L2 domain means no segmentation at all —
  // guests, IoT, servers and management share a broadcast domain.
  const lanNets = networks.filter((n) => !(n.purpose ?? "").startsWith("wan"));
  if (lanNets.length === 1) {
    out.push({
      id: "flat-network",
      severity: "info",
      title: "Single flat network — no VLAN segmentation",
      detail: `Everything shares "${lanNets[0].name}". Splitting guest/IoT/management into VLANs limits what a compromised device can reach and is the foundation the firewall checks above build on.`,
    });
  }

  return out;
}

/** Count of addresses in an inclusive DHCP range, or null if unparseable. */
export function poolSize(start: string, stop: string): number | null {
  const a = ipToInt(start);
  const b = ipToInt(stop);
  if (a == null || b == null || b < a) return null;
  return b - a + 1;
}

function ipToInt(ip: string): number | null {
  const p = ip.trim().split(".");
  if (p.length !== 4) return null;
  const n = p.map(Number);
  if (n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return n[0] * 2 ** 24 + n[1] * 2 ** 16 + n[2] * 256 + n[3];
}
