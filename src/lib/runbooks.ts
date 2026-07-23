import { prisma } from "./prisma";
import { getPortalConfig } from "./config";
import { applyDeviceIgnores } from "./ignoredDevices";
import { canonicalizeMac } from "./mac";
import { getActiveDevicesForPhone, isRegistrationActive } from "./guestDevices";
import {
  getGuestAccessSetting,
  getSiteHealth,
  listActiveGuests,
  listDevices,
  listNetworks,
  listStations,
  listWlans,
} from "./unifi";
import { checkVlanPath, portVlanSummary, traceUplinkChain, uplinkOf } from "./vlanTrace";

import { type RunbookStep, type StepStatus, RUNBOOKS } from "./runbookMeta";

/**
 * Guided troubleshooting runbooks (Cisco DNA Center-style assurance guides):
 * each runbook runs a sequence of live checks against the controller, the
 * local database, and the portal's own configuration, and turns what it finds
 * into operator-readable findings with concrete fixes. Read-only — a runbook
 * never changes anything.
 */

export { RUNBOOKS, type RunbookStep };

const step = (status: StepStatus, title: string, detail?: string, fix?: string): RunbookStep => ({
  status,
  title,
  ...(detail ? { detail } : {}),
  ...(fix ? { fix } : {}),
});

/** The hotspot settings the portal needs (mirrors the one-click config). */
function hotspotProblems(current: Record<string, unknown> | null, portalBaseUrl: string): string[] {
  const problems: string[] = [];
  if (!current) return ["controller returned no guest_access settings section"];
  const url = new URL(portalBaseUrl);
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname);
  if (current.portal_enabled !== true) problems.push("guest portal is disabled");
  if (current.auth !== "custom") problems.push(`portal type is "${current.auth}" instead of External Portal Server`);
  if (current.portal_customized !== false) problems.push("UniFi's own portal page is still enabled");
  const host = isIp ? current.custom_ip : current.portal_hostname;
  if (host !== url.hostname) problems.push(`portal server points at "${host ?? "nothing"}" instead of ${url.hostname}`);
  return problems;
}

async function controllerCheck(steps: RunbookStep[]): Promise<boolean> {
  try {
    await listWlans();
    steps.push(step("pass", "UniFi controller reachable and login works"));
    return true;
  } catch (err) {
    steps.push(
      step(
        "fail",
        "UniFi controller unreachable",
        err instanceof Error ? err.message : String(err),
        'Run the "controller is unreachable" runbook for a breakdown of the failure.',
      ),
    );
    return false;
  }
}

async function guestCantConnect(input: string): Promise<RunbookStep[]> {
  const steps: RunbookStep[] = [];
  const cfg = await getPortalConfig();
  const settings = await prisma.systemSettings.findUnique({ where: { id: "config" } });

  const online = await controllerCheck(steps);

  // Which guest are we talking about?
  const mac = canonicalizeMac(input.trim());
  const phone = mac ? null : input.replace(/[^\d+]/g, "");
  if (!mac && (!phone || phone.length < 5)) {
    steps.push(
      step("fail", "Input not understood", `"${input}" is neither a MAC address nor a phone number.`),
    );
    return steps;
  }

  const rows = await prisma.guestRegistration.findMany({
    where: mac ? { macAddress: mac } : { phone: { contains: phone! } },
    orderBy: { authorizedAt: "desc" },
    take: 10,
  });
  if (rows.length === 0) {
    steps.push(
      step(
        "fail",
        "No registration on file",
        mac ? `No registration for MAC ${mac}.` : `No registration for a phone matching ${phone}.`,
        "The guest never completed the portal form. Have them connect to the guest SSID and register — " +
          'if the portal never appears, run "the captive portal doesn\'t pop up".',
      ),
    );
    return steps;
  }

  const reg = rows[0];
  const name = `${reg.firstName} ${reg.lastName}`.trim();
  steps.push(
    step(
      "info",
      `Latest registration: ${name || "guest"} (${reg.macAddress})`,
      `Registered ${reg.authorizedAt.toISOString().slice(0, 16).replace("T", " ")} UTC, ` +
        `${reg.durationMin > 0 ? `${reg.durationMin} min window` : "never expires"}${reg.locationName ? `, location ${reg.locationName}` : ""}.`,
    ),
  );

  // Authorization window
  if (reg.revokedAt) {
    steps.push(
      step(
        "fail",
        "Registration was revoked",
        `Revoked at ${reg.revokedAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
        "The guest must register again on the portal (or re-authorize from the guest's detail page).",
      ),
    );
  } else if (!isRegistrationActive(reg)) {
    const expired = new Date(reg.authorizedAt.getTime() + reg.durationMin * 60_000);
    steps.push(
      step(
        "fail",
        "Access window expired",
        `Expired ${expired.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
        "The guest can renew from the self-service page or register again on the captive portal.",
      ),
    );
  } else {
    steps.push(step("pass", "Registration is active (not revoked, not expired)"));
  }

  // Email verification gate
  if (settings?.emailVerifyEnabled && !reg.emailVerifiedAt && reg.durationMin > 0) {
    steps.push(
      step(
        "warn",
        "Email not verified",
        "Email verification is enabled and this guest has not confirmed their address — unverified guests only get the initial/grace window.",
        "Have the guest open the confirmation email (check spam), or resend it from the guest's detail page.",
      ),
    );
  }

  // Device cap
  if (reg.phone) {
    const active = await getActiveDevicesForPhone(reg.phone);
    const cap = cfg.maxDevicesPerPhone;
    if (cap > 0 && active.length >= cap) {
      steps.push(
        step(
          "warn",
          `Device cap reached (${active.length}/${cap})`,
          "New devices on this phone number will be refused until one expires or is removed.",
          "The guest can remove a device in self-service, or an operator can revoke one from the guest's page.",
        ),
      );
    } else {
      steps.push(step("pass", `Device cap OK (${active.length}/${cap || "unlimited"} active devices)`));
    }
  }

  if (!online) return steps;

  // Live association
  const target = reg.macAddress.toLowerCase();
  const sta = (await listStations().catch(() => [])).find((s) => s.mac.toLowerCase() === target);
  if (!sta) {
    steps.push(
      step(
        "warn",
        "Device is not connected to WiFi right now",
        "The controller does not see this MAC associated to any AP.",
        "This is client-side: wrong SSID, wrong password, WiFi off, out of range, or the device is using " +
          "MAC randomization (a different MAC per network) — check the device's WiFi settings.",
      ),
    );
  } else {
    const rssi = sta.rssi !== undefined ? `${sta.rssi} dBm` : "unknown signal";
    steps.push(
      step(
        "pass",
        `Device is associated to "${sta.essid ?? "?"}"`,
        `IP ${sta.ip ?? "none yet"}, VLAN ${sta.vlan ?? "?"}, signal ${rssi}.`,
      ),
    );
    if (typeof sta.rssi === "number" && sta.rssi <= -75) {
      steps.push(
        step(
          "warn",
          `Weak WiFi signal (${sta.rssi} dBm)`,
          "Below about -75 dBm connections get slow and flaky.",
          "Move the guest closer to an AP, or review AP placement/power for that area.",
        ),
      );
    }
    if (!sta.ip) {
      steps.push(
        step(
          "warn",
          "Associated but no IP address",
          "The device joined the SSID but has not completed DHCP.",
          "Check the DHCP pool for the guest VLAN (exhausted range?) and that the VLAN is trunked to the AP.",
        ),
      );
    }
  }

  // Controller-side authorization
  const guest = (await listActiveGuests().catch(() => [])).find(
    (g) => g.mac.toLowerCase() === target && g.authorized !== false,
  );
  if (guest) {
    steps.push(step("pass", "Controller authorization present", "The MAC is on the controller's active guest list."));
  } else if (reg.revokedAt || !isRegistrationActive(reg)) {
    steps.push(step("info", "No controller authorization (expected — the registration is not active)"));
  } else {
    steps.push(
      step(
        "fail",
        "Active registration but NO controller authorization",
        "The portal believes this guest has access, but the controller is not authorizing the MAC — it will be stuck on the captive page.",
        "Have the guest submit the portal form again (re-authorizes the MAC). If it persists, check this page's " +
          "Settings -> UniFi connection and the controller's hotspot config.",
      ),
    );
  }

  return steps;
}

function netName(networks: { _id: string; name: string; vlan?: number }[], id?: string): string {
  const n = networks.find((x) => x._id === id);
  return n ? `${n.name.trim()}${n.vlan ? ` (VLAN ${n.vlan})` : ""}` : "default";
}

async function deviceOffline(): Promise<RunbookStep[]> {
  const steps: RunbookStep[] = [];
  if (!(await controllerCheck(steps))) return steps;

  const [allDevices, rawHealth, networks] = await Promise.all([
    listDevices(),
    getSiteHealth().catch(() => []),
    listNetworks().catch(() => []),
  ]);
  // Ignored (offline-on-purpose) devices are not problems to walk through.
  const { devices, health, ignored } = await applyDeviceIgnores(allDevices, rawHealth);
  if (ignored.length > 0) {
    steps.push(
      step(
        "info",
        `${ignored.length} offline device(s) are ignored site-wide and skipped here`,
        ignored.map((d) => d.name || d.mac).join(", "),
      ),
    );
  }
  const disconnected = health.reduce((n, h) => n + (h.num_disconnected ?? 0), 0);
  if (disconnected > 0) {
    steps.push(step("warn", `Site health reports ${disconnected} disconnected device(s)`));
  }

  const FIXES: Record<number, string> = {
    0: "Check power (PoE budget / injector / outlet) and the uplink cable. If it has power, look at its LED pattern and try a power cycle. Last known IP is shown — try pinging it.",
    2: "The device is waiting to be adopted — adopt it in the UniFi console (UniFi Devices -> Click to adopt).",
    4: "A firmware upgrade is in progress — wait a few minutes. If it stays here >15 min, power cycle the device.",
    5: "The controller is pushing configuration — normally settles within a minute or two.",
    6: "The controller lost contact briefly — usually transient. If it repeats, check the uplink/switch port and for IP conflicts.",
    7: "Adoption in progress — wait; if it loops, factory-reset the device and adopt again.",
    9: "Adoption failed — verify the device and controller are on the same L2/L3 path (set-inform address), then retry adoption.",
    10: "The device is managed by another controller — factory-reset it to adopt here.",
    11: "The AP is isolated (no wired uplink) — check its switch port/cable; it cannot serve clients meshed like this unless meshing is intended.",
  };
  const STATE_LABELS: Record<number, string> = {
    0: "offline",
    2: "pending adoption",
    4: "upgrading",
    5: "provisioning",
    6: "heartbeat missed",
    7: "adopting",
    9: "adoption failed",
    10: "managed by other",
    11: "isolated",
  };

  let problems = 0;
  for (const d of devices) {
    const name = d.name || d.mac;
    if (d.state !== 1) {
      problems++;
      steps.push(
        step(
          "fail",
          `${name} is ${STATE_LABELS[d.state ?? -1] ?? `in state ${d.state}`}`,
          `${d.model ?? ""} ${d.ip ? `— last known IP ${d.ip}` : ""}`.trim() || undefined,
          FIXES[d.state ?? -1] ?? "Check the device's power and uplink, then the UniFi console.",
        ),
      );

      // Trace the (last known) uplink: is the switch port it hangs off even up?
      const up = uplinkOf(d);
      const upstream = devices.find(
        (x) => x.mac.toLowerCase() === (up?.uplink_mac ?? "").toLowerCase(),
      );
      const port = up?.uplink_remote_port
        ? (upstream?.port_table ?? []).find((p) => p.port_idx === up.uplink_remote_port)
        : undefined;
      if (upstream && port) {
        const where = `${upstream.name || upstream.mac} port ${port.port_idx}`;
        if (!port.up) {
          steps.push(
            step(
              "fail",
              `${name}: uplink port is DOWN (${where})`,
              "No link on the switch port this device last connected through.",
              "Check the cable on both ends and the device's power. If the port is PoE-powered, check the switch's PoE budget and whether the port has PoE disabled.",
            ),
          );
        } else {
          const poe =
            port.poe_power && Number(port.poe_power) > 0
              ? `, delivering ${Number(port.poe_power).toFixed(1)} W PoE`
              : "";
          steps.push(
            step(
              "info",
              `${name}: uplink port has link (${where}, ${port.speed} Mbps${poe})`,
              `Port VLAN config: ${portVlanSummary(port, (id) => netName(networks, id))}. Link is up, so the cable path is fine — the device itself is not responding.`,
              "Power cycle the device. If it repeats, check that the port's native VLAN matches the management network the device expects — a changed native VLAN strands the device from the controller.",
            ),
          );
        }
      } else if (up?.type === "wireless") {
        steps.push(
          step("info", `${name} was meshed (wireless uplink)`, undefined, "Check the mesh parent AP and signal path."),
        );
      }
      continue;
    }
    if ((d.uptime ?? Infinity) < 600) {
      problems++;
      steps.push(
        step(
          "warn",
          `${name} rebooted ${Math.round((d.uptime ?? 0) / 60)} min ago`,
          "Recent restart — one-off is fine, repeated short uptimes suggest power (PoE budget) or crash problems.",
          "Check the switch's PoE budget and the device's logs in the UniFi console.",
        ),
      );
    }
    const ss = d["system-stats"] ?? {};
    if (Number(ss.cpu) >= 90 || Number(ss.mem) >= 90) {
      problems++;
      steps.push(
        step(
          "warn",
          `${name} under resource pressure (CPU ${ss.cpu ?? "?"}%, mem ${ss.mem ?? "?"}%)`,
          undefined,
          "Sustained high load can drop clients — consider a reboot window, firmware update, or reducing load.",
        ),
      );
    }
  }

  if (problems === 0) {
    steps.push(step("pass", `All ${devices.length} devices online and healthy`));
  }
  return steps;
}

async function vlanTrunking(): Promise<RunbookStep[]> {
  const steps: RunbookStep[] = [];
  if (!(await controllerCheck(steps))) return steps;

  const [devices, networks, wlans] = await Promise.all([
    listDevices(),
    listNetworks(),
    listWlans(),
  ]);

  const guestWlans = wlans.filter((w) => w.enabled !== false && w.is_guest === true);
  if (guestWlans.length === 0) {
    steps.push(
      step(
        "warn",
        "No enabled SSID has the guest policy",
        "There is nothing to trace — guests are not captive-portaled on any SSID.",
        "Enable the guest policy on the guest SSID in Settings -> UniFi.",
      ),
    );
    return steps;
  }
  for (const w of guestWlans) {
    steps.push(
      step(
        "info",
        `Guest SSID "${w.name}" puts clients on ${netName(networks, w.networkconf_id)}`,
      ),
    );
    const net = networks.find((n) => n._id === w.networkconf_id);
    if (net && net.purpose !== "guest" && net.purpose !== "corporate") {
      steps.push(
        step(
          "warn",
          `"${w.name}" maps to a ${net.purpose ?? "?"}-purpose network`,
          "Guest SSIDs normally land on a guest- or corporate-purpose LAN network.",
        ),
      );
    }
  }

  const aps = devices.filter((d) => d.type === "uap");
  if (aps.length === 0) {
    steps.push(step("warn", "No access points found on the site"));
    return steps;
  }

  let problems = 0;
  for (const ap of aps) {
    const apName = ap.name || ap.mac;
    const chain = traceUplinkChain(devices, ap);
    if (chain.length === 0) {
      steps.push(
        step(
          "info",
          `${apName}: no wired uplink information`,
          ap.state !== 1 ? "The AP is not online, and no last-known uplink is recorded." : undefined,
        ),
      );
      continue;
    }
    const path = chain
      .map((h) => `${h.device.name || h.device.mac}${h.portIdx ? ` port ${h.portIdx}` : ""}${h.wireless ? " (mesh)" : ""}`)
      .join(" -> ");

    for (const w of guestWlans) {
      if (!w.networkconf_id) continue;
      const result = checkVlanPath(devices, ap, w.networkconf_id, networks);
      const vlanLabel = netName(networks, w.networkconf_id);
      if (result.ok && !result.unknown) {
        steps.push(step("pass", `${apName}: ${vlanLabel} is carried on the whole path`, `Path: ${path}.`));
      } else if (result.unknown) {
        steps.push(step("info", `${apName}: could not judge the path for ${vlanLabel}`, `Path: ${path}.`));
      } else {
        problems++;
        steps.push(
          step(
            "fail",
            `${apName}: ${vlanLabel} is BLOCKED at ${result.blockedAt!.deviceName}${result.blockedAt!.portIdx ? ` port ${result.blockedAt!.portIdx}` : ""}`,
            `That port's VLAN config: ${result.blockedAt!.summary}. Clients joining "${w.name}" through this AP will get no DHCP lease.`,
            "Edit that switch port in the UniFi console (Ports -> the port -> VLAN settings / port profile) and allow the guest network tagged on it.",
          ),
        );
      }
    }

    // The management path matters too: the AP itself talks untagged on the
    // native VLAN of its uplink port.
    const first = chain[0];
    if (first.port && !first.wireless) {
      steps.push(
        step(
          "info",
          `${apName}: uplink native network is ${netName(networks, first.port.native_networkconf_id)}`,
          "The AP manages/adopts over this untagged network — if it was recently changed, the AP can fall off the controller.",
        ),
      );
    }
  }

  if (problems === 0) {
    steps.push(step("pass", "No trunking problems found on any AP uplink path"));
  }
  return steps;
}

async function portalNotRedirecting(): Promise<RunbookStep[]> {
  const steps: RunbookStep[] = [];
  const cfg = await getPortalConfig();

  // Portal-side configuration
  if (!cfg.portalBaseUrl) {
    steps.push(
      step("fail", "Captive Portal URL is not set", undefined, "Set it in Settings -> URLs and save."),
    );
    return steps;
  }
  let portalUrl: URL | null = null;
  try {
    portalUrl = new URL(cfg.portalBaseUrl);
    steps.push(step("pass", `Captive Portal URL configured: ${cfg.portalBaseUrl}`));
    if (portalUrl.protocol === "https:") {
      steps.push(
        step(
          "warn",
          "Captive URL is HTTPS",
          "Captive-portal detection on phones uses plain HTTP probes; an HTTPS captive URL commonly breaks the popup.",
          "Serve the captive host over plain HTTP (the reverse proxy must not force-redirect it to HTTPS).",
        ),
      );
    }
  } catch {
    steps.push(step("fail", `Captive Portal URL is not a valid URL: ${cfg.portalBaseUrl}`));
    return steps;
  }

  // Can the portal actually be reached?
  try {
    const res = await fetch(`${cfg.portalBaseUrl.replace(/\/+$/, "")}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      steps.push(step("pass", "Captive URL answers", `GET ${portalUrl.hostname}/api/health returned ${res.status}.`));
    } else {
      steps.push(
        step(
          "fail",
          `Captive URL responds with HTTP ${res.status}`,
          undefined,
          "Something answers on that hostname but not this portal — check DNS and the reverse-proxy (Traefik) route.",
        ),
      );
    }
  } catch (err) {
    steps.push(
      step(
        "fail",
        "Captive URL does not answer",
        err instanceof Error ? err.message : String(err),
        `Guests are being redirected to ${portalUrl.hostname} but nothing responds. Check LAN DNS for that hostname ` +
          "(it must resolve to this portal on the guest VLAN) and any firewall rules between the guest VLAN and the portal.",
      ),
    );
  }

  if (!(await controllerCheck(steps))) return steps;

  // Controller-side hotspot configuration
  const [guestAccess, wlans] = await Promise.all([
    getGuestAccessSetting().catch(() => null),
    listWlans().catch(() => []),
  ]);
  const problems = hotspotProblems(guestAccess, cfg.portalBaseUrl);
  if (problems.length === 0) {
    steps.push(step("pass", "Controller hotspot settings match this portal"));
  } else {
    steps.push(
      step(
        "fail",
        "Controller hotspot settings are wrong",
        problems.join("; ") + ".",
        "Use the one-click hotspot configuration in Settings -> UniFi to fix all of it at once.",
      ),
    );
  }

  const guestSsids = wlans.filter((w) => w.enabled !== false && w.is_guest === true);
  if (guestSsids.length === 0) {
    steps.push(
      step(
        "fail",
        "No enabled SSID has the guest policy",
        "Without the guest policy, clients are never captive-redirected.",
        "Enable it per SSID in Settings -> UniFi (the one-click section lists every SSID).",
      ),
    );
  } else {
    steps.push(
      step("pass", `Guest policy active on: ${guestSsids.map((w) => w.name).join(", ")}`),
    );
  }

  steps.push(
    step(
      "info",
      "Still not popping up? Client-side checklist",
      "1) The popup only triggers on join — toggle WiFi off/on. 2) Phones with 'Private WiFi address' (MAC " +
        "randomization) re-trigger the portal per network. 3) Devices with a VPN or private DNS often suppress " +
        "the popup — open http://neverssl.com manually. 4) The guest VLAN must allow DNS and the portal host " +
        "pre-authorization (walled garden).",
    ),
  );

  return steps;
}

async function controllerUnreachable(): Promise<RunbookStep[]> {
  const steps: RunbookStep[] = [];
  const cfg = await getPortalConfig();

  if (!cfg.unifiUrl || !cfg.unifiUsername || !cfg.unifiPassword) {
    steps.push(
      step(
        "fail",
        "UniFi connection is not fully configured",
        `URL ${cfg.unifiUrl ? "set" : "MISSING"}, username ${cfg.unifiUsername ? "set" : "MISSING"}, password ${cfg.unifiPassword ? "set" : "MISSING"}.`,
        "Fill in Settings -> UniFi and use its Test Connection button.",
      ),
    );
    return steps;
  }
  steps.push(step("info", `Controller: ${cfg.unifiUrl} (site "${cfg.unifiSite}", API type ${cfg.unifiApiType})`));

  try {
    const wlans = await listWlans();
    steps.push(step("pass", "Login and API access work", `The controller answered with ${wlans.length} WLAN(s).`));
    const health = await getSiteHealth().catch(() => []);
    const summary = health
      .filter((h) => h.status && h.status !== "unknown")
      .map((h) => `${h.subsystem}: ${h.status}`)
      .join(", ");
    if (summary) steps.push(step("info", "Site health", summary));
    steps.push(step("pass", "Nothing to fix — the controller is reachable from the portal."));
    return steps;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (/certificate|CERT|TLS|SSL/i.test(msg)) {
      steps.push(
        step(
          "fail",
          "TLS certificate rejected",
          msg,
          'Controllers use self-signed certificates by default — enable "Accept self-signed certificate" in Settings -> UniFi, or install a trusted certificate on the controller.',
        ),
      );
    } else if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|network/i.test(msg)) {
      steps.push(
        step(
          "fail",
          "Network-level failure (DNS/route/port)",
          msg,
          `Verify the controller URL (${cfg.unifiUrl}) — right IP and port (UniFi OS: 443, self-hosted: 8443)? ` +
            "Can this portal's VLAN reach the controller (firewall rules)? Does the hostname resolve from the portal container?",
        ),
      );
    } else if (/401|Invalid|LoginRequired|credentials|password/i.test(msg)) {
      steps.push(
        step(
          "fail",
          "Login rejected (credentials)",
          msg,
          "The account must be a LOCAL controller admin (not a Ubiquiti cloud account) and 2FA must be off for it. " +
            "Reset the hotspot user's password on the controller and update Settings -> UniFi.",
        ),
      );
    } else if (/403|permission|forbidden/i.test(msg)) {
      steps.push(
        step(
          "fail",
          "Logged in but not permitted",
          msg,
          'Give the account at least the "Hotspot" role (or Site Admin) for this site on the controller.',
        ),
      );
    } else {
      steps.push(
        step(
          "fail",
          "Controller request failed",
          msg,
          "Check the controller URL and API type in Settings -> UniFi, then use Test Connection.",
        ),
      );
    }
    return steps;
  }
}

export async function runRunbook(id: string, input?: string): Promise<RunbookStep[]> {
  switch (id) {
    case "guest-cant-connect":
      return guestCantConnect(input ?? "");
    case "device-offline":
      return deviceOffline();
    case "vlan-trunking":
      return vlanTrunking();
    case "portal-not-redirecting":
      return portalNotRedirecting();
    case "controller-unreachable":
      return controllerUnreachable();
    default:
      throw new Error(`Unknown runbook: ${id}`);
  }
}
