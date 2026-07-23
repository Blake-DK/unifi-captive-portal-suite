import type { UniFiDeviceHealth, UniFiEvent, UniFiStation, UniFiSubsystemHealth } from "./unifi";

/**
 * Unified issue derivation for the NOC surfaces (/admin/issues, the map
 * overlay, the APs tab). Pure functions over one controller snapshot — no
 * DB, no fetches — so every page shares identical definitions of "an issue"
 * and the map can anchor each one to a device by MAC.
 */

export type NetIssue = {
  severity: "error" | "warning";
  category: "device" | "subsystem" | "port" | "radio" | "client";
  deviceMac?: string; // anchor for the map / grouping (lowercase)
  deviceName?: string;
  portIdx?: number;
  text: string;
};

/** The per-device slice a dialog/badge needs — what groupIssuesByDevice emits. */
export type DeviceIssue = { severity: "error" | "warning"; text: string };

/** Anchor issues to their device, keyed by lowercase MAC. A plain object so
 * it can cross the server→client boundary; the map, Network Status and the
 * APs page all hand the same shape to the shared device dialog. */
export function groupIssuesByDevice(issues: NetIssue[]): Record<string, DeviceIssue[]> {
  const byDevice: Record<string, DeviceIssue[]> = {};
  for (const i of issues) {
    if (!i.deviceMac) continue;
    (byDevice[i.deviceMac] ??= []).push({ severity: i.severity, text: i.text });
  }
  return byDevice;
}

const SUBSYSTEM_LABELS: Record<string, string> = {
  wlan: "WiFi",
  lan: "LAN",
  wan: "WAN",
  www: "Internet",
  vpn: "VPN",
};

const DEVICE_STATES: Record<number, string> = {
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

const norm = (m?: string) => (m ?? "").toLowerCase();

/** Which health subsystem counts a device, and under which total. */
function subsystemOf(type?: string): { subsystem: string; totalKey: "num_ap" | "num_sw" } | null {
  if (type === "uap") return { subsystem: "wlan", totalKey: "num_ap" };
  if (type === "usw") return { subsystem: "lan", totalKey: "num_sw" };
  // Building bridges are wireless gear, assumed counted with the WiFi fleet
  // (unverified against a live controller; the visible-offline floor in
  // adjustHealthForIgnored keeps a wrong mapping from hiding anything).
  // "CN" is a site naming token, not a controller type — a core node reports
  // uxg/usw and is covered above or left alone with the gateways.
  if (type === "ubb") return { subsystem: "wlan", totalKey: "num_ap" };
  return null; // gateways and anything unfamiliar: leave the controller's numbers alone
}

/**
 * Subtract ignored devices from the controller's own subsystem counts.
 *
 * `activeIgnoredMacs` filters the device LIST, but `/stat/health` is computed
 * controller-side and still counts an ignored switch under
 * `lan.num_disconnected`, so an ignored device kept surfacing as an issue and
 * in the LAN card. Pass the devices that were filtered out; every surface that
 * reads health should adjust it first.
 *
 * Only state 0 comes off `num_disconnected`: transitional states
 * (provisioning, heartbeat missed) are assumed NOT counted by the controller.
 * That assumption is unverified live, but its failure mode is a phantom
 * disconnect on the card, whereas subtracting a transitional device the
 * controller didn't count would hide a real outage owed to another device.
 *
 * Pass `visibleDevices` (the non-ignored rest of the same list) and the
 * count additionally never drops below the visibly-offline devices of that
 * subsystem — so even a wrong type→subsystem mapping cannot hide a device an
 * operator can still see is down.
 */
export function adjustHealthForIgnored(
  health: UniFiSubsystemHealth[],
  ignoredDevices: UniFiDeviceHealth[],
  visibleDevices: UniFiDeviceHealth[] = [],
): UniFiSubsystemHealth[] {
  if (ignoredDevices.length === 0) return health;
  return health.map((h) => {
    const mine = ignoredDevices.filter((d) => subsystemOf(d.type)?.subsystem === h.subsystem);
    if (mine.length === 0) return h;
    const totalKey = subsystemOf(mine[0].type)!.totalKey;
    const offline = mine.filter((d) => d.state === 0).length;
    const visibleOffline = visibleDevices.filter(
      (d) => d.state === 0 && subsystemOf(d.type)?.subsystem === h.subsystem,
    ).length;
    const adjusted: UniFiSubsystemHealth = { ...h };
    if (h[totalKey] !== undefined) adjusted[totalKey] = Math.max(0, h[totalKey]! - mine.length);
    if (h.num_disconnected !== undefined) {
      adjusted.num_disconnected = Math.max(visibleOffline, h.num_disconnected - offline);
    }
    // The controller degrades `status` for reasons of its own, so it is only
    // overridden when every raw disconnect is attributable to ignored
    // devices and none remain; a degradation owed to anything else survives.
    if (
      (h.status === "warning" || h.status === "error") &&
      (h.num_disconnected ?? 0) > 0 &&
      adjusted.num_disconnected === 0 &&
      offline >= h.num_disconnected!
    ) {
      adjusted.status = "ok";
    }
    return adjusted;
  });
}

/** Device/subsystem health issues (same rules as the Status page's list). */
export function deviceIssues(health: UniFiSubsystemHealth[], devices: UniFiDeviceHealth[]): NetIssue[] {
  const issues: NetIssue[] = [];

  for (const h of health) {
    if (h.status && h.status !== "ok" && h.status !== "unknown") {
      issues.push({
        severity: h.status === "error" ? "error" : "warning",
        category: "subsystem",
        text: `${SUBSYSTEM_LABELS[h.subsystem] ?? h.subsystem} subsystem reports ${h.status}`,
      });
    }
    if ((h.num_disconnected ?? 0) > 0) {
      issues.push({
        severity: "error",
        category: "subsystem",
        text: `${h.num_disconnected} ${SUBSYSTEM_LABELS[h.subsystem] ?? h.subsystem} device(s) disconnected`,
      });
    }
  }

  for (const d of devices) {
    const name = d.name || d.mac;
    const mac = norm(d.mac);
    if (d.state !== 1) {
      issues.push({
        severity: "error",
        category: "device",
        deviceMac: mac,
        deviceName: name,
        text: `${name}: ${DEVICE_STATES[d.state ?? -1] ?? `state ${d.state}`}`,
      });
    }
    if (d.upgradable) {
      issues.push({ severity: "warning", category: "device", deviceMac: mac, deviceName: name, text: `${name}: firmware update available` });
    }
    const ss = d["system-stats"] ?? {};
    const cpu = Number(ss.cpu);
    const mem = Number(ss.mem);
    if (cpu >= 90) issues.push({ severity: "warning", category: "device", deviceMac: mac, deviceName: name, text: `${name}: CPU at ${cpu.toFixed(0)}%` });
    if (mem >= 90) issues.push({ severity: "warning", category: "device", deviceMac: mac, deviceName: name, text: `${name}: memory at ${mem.toFixed(0)}%` });
    for (const r of d.radio_table_stats ?? []) {
      if ((r.cu_total ?? 0) >= 80) {
        issues.push({
          severity: "warning",
          category: "radio",
          deviceMac: mac,
          deviceName: name,
          text: `${name}: channel ${r.channel} is ${r.cu_total}% utilized`,
        });
      }
    }
  }

  return issues;
}

export type PortFlap = {
  deviceMac: string;
  deviceName: string;
  portIdx?: number;
  transitions: number; // link up/down events in the window
  lastAt?: number; // epoch ms of the most recent transition
};

/**
 * Flap detection from the controller event log: N link up/down transitions
 * for the same (device, port) within the window. The port number isn't
 * always a dedicated field, so fall back to parsing it out of the message.
 */
export function detectPortFlaps(events: UniFiEvent[], minTransitions = 4): PortFlap[] {
  const byPort = new Map<string, PortFlap>();
  for (const e of events) {
    if (!e.key || !/portlink/i.test(e.key)) continue;
    const mac = norm(e.sw ?? e.ap ?? e.gw);
    if (!mac) continue;
    const portRaw = e.port ?? e.msg?.match(/port\s+(\d+)/i)?.[1];
    const portIdx = portRaw !== undefined ? Number(portRaw) : undefined;
    const key = `${mac}:${portIdx ?? "?"}`;
    const cur = byPort.get(key) ?? {
      deviceMac: mac,
      deviceName: e.sw_name ?? e.ap_name ?? e.gw_name ?? mac,
      portIdx: Number.isFinite(portIdx) ? portIdx : undefined,
      transitions: 0,
      lastAt: undefined,
    };
    cur.transitions++;
    if (e.time && (!cur.lastAt || e.time > cur.lastAt)) cur.lastAt = e.time;
    byPort.set(key, cur);
  }
  return [...byPort.values()].filter((f) => f.transitions >= minTransitions).sort((a, b) => b.transitions - a.transitions);
}

export function flapIssues(flaps: PortFlap[], windowHours: number): NetIssue[] {
  return flaps.map((f) => ({
    severity: "warning" as const,
    category: "port" as const,
    deviceMac: f.deviceMac,
    deviceName: f.deviceName,
    portIdx: f.portIdx,
    text: `${f.deviceName}${f.portIdx !== undefined ? ` port ${f.portIdx}` : ""}: link flapping — ${f.transitions} up/down events in ${windowHours}h`,
  }));
}

/**
 * Clients with poor wireless signal, anchored to their AP. UniFi's classic
 * station `rssi` is dB above noise floor (higher = better); below ~15 the
 * connection is marginal and retries/roam problems follow.
 */
export function weakClientIssues(stations: UniFiStation[], apNames: Map<string, string>): NetIssue[] {
  const issues: NetIssue[] = [];
  for (const s of stations) {
    if (s.is_wired || s.rssi === undefined || s.rssi >= 15 || !s.ap_mac) continue;
    const apMac = norm(s.ap_mac);
    const apName = apNames.get(apMac) ?? apMac;
    const who = s.name ?? s.hostname ?? s.mac;
    issues.push({
      severity: "warning",
      category: "client",
      deviceMac: apMac,
      deviceName: apName,
      text: `${who} on ${apName}: weak signal (RSSI ${s.rssi})`,
    });
  }
  return issues;
}

const sevRank = { error: 0, warning: 1 } as const;

/** Everything, one list, errors first. */
export function collectIssues(opts: {
  health: UniFiSubsystemHealth[];
  devices: UniFiDeviceHealth[];
  stations: UniFiStation[];
  events: UniFiEvent[];
  eventWindowHours: number;
}): { issues: NetIssue[]; flaps: PortFlap[] } {
  const apNames = new Map(opts.devices.map((d) => [norm(d.mac), d.name || d.mac]));
  const flaps = detectPortFlaps(opts.events);
  const issues = [
    ...deviceIssues(opts.health, opts.devices),
    ...flapIssues(flaps, opts.eventWindowHours),
    ...weakClientIssues(opts.stations, apNames),
  ].sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
  return { issues, flaps };
}
