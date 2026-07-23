import type {
  CriticalAssessment,
  CriticalEntry,
  CriticalVerdict,
  FirewallTarget,
  LockoutAssessment,
  PlanNetwork,
} from "./firewallPlan";

/**
 * Zone-based firewall *planner* — the native plan model for UniFi Network 9+
 * controllers, where rules are policies between zones (Policy Engine), not
 * classic ruleset entries. Instead of planning subnet→IP rules and translating
 * them at apply time (the old approach, which kept colliding with what the
 * v2 policy endpoint actually accepts), this plans in the controller's own
 * vocabulary: source = a zone or specific networks within it, destination = a
 * zone or a single IP(+port) inside one. The apply route writes exactly what
 * this previews — `policyPayload` is the one place the wire shape lives.
 *
 * Pure/testable like the classic planner; nothing here touches the network.
 * Zone-level facts this leans on:
 * - traffic BETWEEN zones is policy-controlled; traffic WITHIN a zone is not
 *   firewalled at all — so a guest network sharing a zone with corporate
 *   networks cannot be isolated by any policy (we flag it instead);
 * - policy precedence is index order, so ALLOWs are planned above BLOCKs;
 * - subnet-scoped matching uses the zone/network selectors, not raw CIDRs in
 *   `ips[]` — the controller accepts both (seen live), but zones/networks
 *   are the vocabulary the UniFi UI renders back to the operator.
 */

export type ZbfZone = {
  id: string;
  name: string;
  networkIds: string[];
};

// Local copies of the two tiny IP helpers (also in firewallPlan.ts): modules
// under the Node test runner keep local imports type-only, because the
// type-stripping runner cannot resolve extensionless runtime imports.
function isValidIp(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
}

function ipToInt(ip: string): number | null {
  if (!isValidIp(ip)) return null;
  const n = ip.trim().split(".").map(Number);
  return n[0] * 2 ** 24 + n[1] * 2 ** 16 + n[2] * 256 + n[3];
}

/** RFC1918/link-local/loopback — an admin arriving from a PUBLIC address
 * reaches the portal via the WAN path, which inter-zone LAN blocks never touch. */
function isPrivateIp(ip: string): boolean {
  const o = ip.trim().split(".").map(Number);
  return (
    o[0] === 10 ||
    (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
    (o[0] === 192 && o[1] === 168) ||
    (o[0] === 169 && o[1] === 254) ||
    o[0] === 127
  );
}

/** True when `ip` falls inside `cidr` ("10.90.0.1/24" style gateway CIDRs work too). */
function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const a = ipToInt(ip);
  const b = ipToInt(base ?? "");
  if (a == null || b == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

export type PolicyEndpoint = {
  zoneId: string;
  zoneName: string;
  /** Specific networks in the zone, or null = the whole zone (ANY). */
  networkIds: string[] | null;
  /** Single IP inside the zone (destination targets), or null. */
  ip: string | null;
  /** Single destination port, or null = any. */
  port: string | null;
  /** Human rendering for tables/warnings, e.g. `zone “Hotspot”` or `Guest, Events`. */
  label: string;
};

export type PlannedPolicy = {
  order: number;
  action: "ALLOW" | "BLOCK";
  /** Becomes the policy name (with the "Portal: " prefix and port suffix) at apply. */
  name: string;
  protocol: "tcp" | "udp" | "tcp_udp" | "icmp" | "all";
  source: PolicyEndpoint;
  destination: PolicyEndpoint;
};

export type ZbfPlan = {
  policies: PlannedPolicy[];
  notes: string[];
};

/** The portal serves plain HTTP on :80; the bundled proxy adds :443. */
const PORTAL_PORTS = ["80"];
const PROXY_PORTS = ["80", "443"];

function zoneEndpoint(zone: ZbfZone, networkIds: string[] | null, label: string): PolicyEndpoint {
  return { zoneId: zone.id, zoneName: zone.name, networkIds, ip: null, port: null, label };
}

function ipEndpoint(zone: ZbfZone, ip: string, port: string | null): PolicyEndpoint {
  return {
    zoneId: zone.id,
    zoneName: zone.name,
    networkIds: null,
    ip,
    port,
    label: port ? `${ip}:${port}` : ip,
  };
}

/**
 * Build the zone-based plan. `selected` are the networks allowed to reach the
 * targets; every guest network NOT selected gets an explicit BLOCK to the
 * targets, and every zone holding guest networks gets Isolate BLOCKs to the
 * other zones (below the ALLOWs). `allNetworks` is the full non-WAN network
 * list; `zones` the controller's firewall zones.
 */
export function buildZbfPlan(
  selected: PlanNetwork[],
  portal: FirewallTarget,
  proxy: FirewallTarget | null,
  allNetworks: PlanNetwork[],
  zones: ZbfZone[],
  criticalAllows: CriticalEntry[] = [],
): ZbfPlan {
  const notes: string[] = [];
  const policies: PlannedPolicy[] = [];
  let order = 0;

  const knownIds = new Set(allNetworks.map((n) => n.id));
  const zoneOfNet = (id: string): ZbfZone | undefined => zones.find((z) => z.networkIds.includes(id));
  const netOfIp = (ip: string): PlanNetwork | undefined =>
    allNetworks.find((n) => n.subnet && ipInCidr(ip, n.subnet));
  const zoneOfIp = (ip: string): ZbfZone | undefined => {
    const net = netOfIp(ip);
    return net ? zoneOfNet(net.id) : undefined;
  };

  if (!isValidIp(portal.ip)) {
    notes.push(
      `Portal address "${portal.ip}" is not an IP — set Proxy Target IP (Settings → URLs) so the policies can name it.`,
    );
    return { policies, notes };
  }
  const portalZone = zoneOfIp(portal.ip);
  if (!portalZone) {
    notes.push(
      `Portal IP ${portal.ip} is not inside any network that belongs to a firewall zone — the destination cannot be placed. Check the controller's zone assignments (Settings → Policy Engine → Zones).`,
    );
    return { policies, notes };
  }

  // Targets. With the bundled proxy the two share one IP — one merged target
  // on the proxy's ports, instead of duplicate :80 policies under two names.
  type Target = { name: string; ip: string; ports: string[]; zone: ZbfZone };
  const targets: Target[] = [];
  if (proxy && isValidIp(proxy.ip) && proxy.ip === portal.ip) {
    targets.push({ name: `${portal.name} (via ${proxy.name})`, ip: portal.ip, ports: PROXY_PORTS, zone: portalZone });
  } else {
    targets.push({ name: portal.name, ip: portal.ip, ports: PORTAL_PORTS, zone: portalZone });
    if (proxy && isValidIp(proxy.ip)) {
      const proxyZone = zoneOfIp(proxy.ip);
      if (proxyZone) targets.push({ name: proxy.name, ip: proxy.ip, ports: PROXY_PORTS, zone: proxyZone });
      else
        notes.push(
          `${proxy.name} IP ${proxy.ip} is not inside any zoned network — add its policies by hand.`,
        );
    } else if (proxy) {
      notes.push(
        `Reverse-proxy address "${proxy.ip}" is not an IP — resolve it to the LAN IP the gateway sees and add the matching policies by hand.`,
      );
    }
  }

  // Group networks by their zone; unzoned ones are reported via `onUnzoned`.
  const groupByZone = (
    nets: PlanNetwork[],
    onUnzoned: (net: PlanNetwork) => void,
  ): Map<ZbfZone, PlanNetwork[]> => {
    const m = new Map<ZbfZone, PlanNetwork[]>();
    for (const n of nets) {
      const z = zoneOfNet(n.id);
      if (!z) {
        onUnzoned(n);
        continue;
      }
      const list = m.get(z) ?? [];
      list.push(n);
      m.set(z, list);
    }
    return m;
  };

  // Source endpoint for a set of networks in one zone: the whole zone when the
  // set covers every (known, non-WAN) network in it, else the specific ones.
  const sourceFor = (zone: ZbfZone, nets: PlanNetwork[]): PolicyEndpoint => {
    const knownInZone = zone.networkIds.filter((id) => knownIds.has(id));
    const whole = nets.length === knownInZone.length;
    return zoneEndpoint(
      zone,
      whole ? null : nets.map((n) => n.id),
      whole ? `zone “${zone.name}”` : nets.map((n) => n.name).join(", "),
    );
  };

  // ALLOW policies first — per (zone group × target × port), so the preview is
  // exactly the policy list the apply writes.
  const selectedByZone = groupByZone(selected, (n) =>
    notes.push(`"${n.name}" is not assigned to any firewall zone on the controller — skipped; add its policy by hand.`),
  );
  for (const [zone, nets] of selectedByZone) {
    const src = sourceFor(zone, nets);
    for (const t of targets) {
      for (const port of t.ports) {
        policies.push({
          order: ++order,
          action: "ALLOW",
          name: `Allow ${src.label} → ${t.name}`,
          protocol: "tcp",
          source: src,
          destination: ipEndpoint(t.zone, t.ip, port),
        });
      }
    }
  }

  // Guest-zone grouping, shared by the DNS allows and the isolation blocks
  // below. A zone mixing guest and non-guest networks can't be handled at
  // zone level (traffic inside a zone is not firewalled), so its source
  // falls back to the guest networks themselves.
  const guestByZone = groupByZone(allNetworks.filter((n) => n.isGuest), () => {});
  const guestSrcFor = (zone: ZbfZone, guestNets: PlanNetwork[], mixed: boolean): PolicyEndpoint =>
    mixed
      ? zoneEndpoint(zone, guestNets.map((n) => n.id), guestNets.map((n) => n.name).join(", "))
      : zoneEndpoint(zone, null, `zone “${zone.name}”`);
  const isMixed = (zone: ZbfZone): boolean =>
    allNetworks.some((n) => !n.isGuest && zoneOfNet(n.id) === zone);

  // Keep DNS working across the isolation blocks: each guest zone gets an
  // ALLOW :53 to every DNS server its networks' DHCP hands out that lives in
  // ANOTHER zone (same-zone or off-LAN resolvers are unaffected by the
  // blocks). Without these, isolating the guest zone silently breaks name
  // resolution for guests pointed at an internal DNS server.
  // One dedupe pool for the DNS allows and the critical allows below — a DNS
  // server that is ALSO a critical entry @53 must not get twin policies.
  const allowKeys = new Set<string>();
  for (const [zone, guestNets] of guestByZone) {
    const src = guestSrcFor(zone, guestNets, isMixed(zone));
    for (const dns of guestNets.flatMap((n) => n.dnsServers ?? [])) {
      if (!isValidIp(dns) || allowKeys.has(`${zone.id}|${dns}|53`)) continue;
      const dnsZone = zoneOfIp(dns);
      if (!dnsZone || dnsZone === zone) continue;
      allowKeys.add(`${zone.id}|${dns}|53`);
      policies.push({
        order: ++order,
        action: "ALLOW",
        name: `Allow ${src.label} → DNS ${dns}`,
        protocol: "tcp_udp",
        source: src,
        destination: ipEndpoint(dnsZone, dns, "53"),
      });
    }
  }

  // Critical infrastructure guests must keep reaching (DNS/DHCP servers…):
  // operator-flagged critical addresses become ALLOWs above the isolation
  // blocks, one per guest zone × declared service (@all = a single every-
  // port/every-protocol policy; ping = its own ICMP policy). Entries in the
  // SAME zone need no policy (intra-zone traffic is never firewalled);
  // unplaceable ones get a note.
  for (const e of criticalAllows) {
    if (!e.allow) continue;
    const baseIp = e.addr.split("/")[0];
    const entryZone = zoneOfIp(baseIp);
    if (!entryZone) {
      notes.push(
        `Critical address ${e.addr} is not inside any zoned network — its allow policies must be added by hand.`,
      );
      continue;
    }
    for (const [zone, guestNets] of guestByZone) {
      if (zone === entryZone) continue;
      const src = guestSrcFor(zone, guestNets, isMixed(zone));
      const services: { port: string | null; proto: PlannedPolicy["protocol"]; tag?: string }[] =
        e.allow === "all"
          ? [{ port: null, proto: "all" }]
          : [
              ...e.allow.services.map((s) => ({ port: s.port as string | null, proto: s.proto })),
              ...(e.allow.ping ? [{ port: null, proto: "icmp" as const, tag: " (ping)" }] : []),
            ];
      for (const s of services) {
        const key = `${zone.id}|${e.addr}|${s.port ?? "any"}|${s.proto}`;
        // The auto-DNS allows above use tcp_udp:53 — treat a tcp_udp critical
        // service on the same ip:port as the same policy.
        const dnsKey = `${zone.id}|${e.addr}|${s.port ?? "any"}`;
        if (allowKeys.has(key) || (s.proto === "tcp_udp" && allowKeys.has(dnsKey))) continue;
        allowKeys.add(key);
        policies.push({
          order: ++order,
          action: "ALLOW",
          name: `Allow ${src.label} → critical ${e.addr}${s.tag ?? ""}`,
          protocol: s.proto,
          source: src,
          destination: ipEndpoint(entryZone, e.addr, s.port),
        });
      }
    }
  }

  // Explicit BLOCK for guest networks the operator did NOT tick — so their
  // exclusion is deliberate and visible, not merely implied by zone defaults.
  const selectedIds = new Set(selected.map((n) => n.id));
  const untickedGuests = allNetworks.filter((n) => n.isGuest && !selectedIds.has(n.id));
  const untickedByZone = groupByZone(untickedGuests, (n) =>
    notes.push(`Guest network "${n.name}" is not assigned to any firewall zone — its block policy must be added by hand.`),
  );
  for (const [zone, nets] of untickedByZone) {
    const src = sourceFor(zone, nets);
    for (const t of targets) {
      policies.push({
        order: ++order,
        action: "BLOCK",
        name: `Block ${src.label} → ${t.name}`,
        protocol: "all",
        source: src,
        destination: ipEndpoint(t.zone, t.ip, null),
      });
    }
  }

  // Guest isolation, the zone-native way: BLOCK from each guest-holding zone
  // to every other zone that holds networks (below the ALLOWs). Traffic inside
  // a zone cannot be firewalled, so a zone mixing guest and non-guest networks
  // gets flagged instead of silently "isolated".
  const zonesWithNets = zones.filter((z) => z.networkIds.some((id) => knownIds.has(id)));
  for (const [zone, guestNets] of guestByZone) {
    const mixed = isMixed(zone);
    if (mixed) {
      const nonGuestInZone = allNetworks.filter((n) => !n.isGuest && zoneOfNet(n.id) === zone);
      notes.push(
        `Zone “${zone.name}” mixes guest (${guestNets.map((n) => n.name).join(", ")}) and non-guest (${nonGuestInZone.map((n) => n.name).join(", ")}) networks. Traffic inside a zone is not firewalled, so no policy can keep those guests off the other networks in the zone — move the guest networks to a dedicated Hotspot-type zone.`,
      );
    }
    const src = guestSrcFor(zone, guestNets, mixed);
    for (const other of zonesWithNets) {
      if (other === zone) continue;
      policies.push({
        order: ++order,
        action: "BLOCK",
        name: `Isolate ${src.label} — block traffic to zone ${other.name}`,
        protocol: "all",
        source: src,
        destination: zoneEndpoint(other, null, `zone “${other.name}”`),
      });
    }
  }
  if (guestByZone.size > 0 && policies.some((p) => p.name.startsWith("Isolate"))) {
    notes.push(
      "Zone-based firewalls usually block Hotspot→Internal traffic by default — the Isolate policies make that explicit and cover custom zones. The ALLOW policies sit above them, so the portal stays reachable.",
    );
  }

  if (policies.length > 0) {
    notes.push(
      "Policies apply in the order shown (ALLOWs above BLOCKs) — the same order they are written to the Policy Engine.",
    );
    notes.push(
      "These are a reviewed starting point, not auto-applied — confirm each against your topology in the UniFi console (Settings → Policy Engine).",
    );
  }
  return { policies, notes };
}

/**
 * Lockout guard for the zone-based apply: decide whether the planned BLOCKs
 * would sever the very admin session doing the applying. The admin's IP is
 * resolved to its network and zone; a BLOCK whose source covers that network
 * and whose destination reaches a portal target (by IP, or by covering the
 * target's whole zone) blocks the apply — unless an ALLOW above it keeps that
 * target reachable.
 */
export function assessZbfLockout(
  policies: PlannedPolicy[],
  adminIp: string | null,
  allNetworks: PlanNetwork[],
  zones: ZbfZone[],
  targetIps: string[],
): LockoutAssessment {
  if (!adminIp || !isValidIp(adminIp)) {
    return {
      blocked: false,
      adminIp: adminIp ?? null,
      warnings: [
        "Your client IP could not be determined, so the lockout check cannot vouch for this apply. Only proceed if you are certain your own network keeps access to the portal.",
      ],
    };
  }
  const zoneOfNet = (id: string): ZbfZone | undefined => zones.find((z) => z.networkIds.includes(id));
  const adminNet = allNetworks.find((n) => n.subnet && ipInCidr(adminIp, n.subnet));
  const adminZone = adminNet ? zoneOfNet(adminNet.id) : undefined;
  if (!adminNet || !adminZone) {
    // A PUBLIC source address means this session comes in over the internet
    // (WAN/reverse proxy) — zone-to-zone LAN blocks cannot sever that path.
    if (!isPrivateIp(adminIp)) {
      return {
        blocked: false,
        adminIp,
        warnings: [
          `Lockout check passed: your session arrives from the internet (${adminIp}) — LAN firewall blocks between zones cannot sever it.`,
        ],
      };
    }
    return {
      blocked: false,
      adminIp,
      warnings: [
        `Your IP ${adminIp} is not inside any zoned network the controller knows, so the lockout check cannot vouch for this apply. Only proceed if you are certain your own network keeps access to the portal.`,
      ],
    };
  }

  const covers = (src: PolicyEndpoint): boolean =>
    src.zoneId === adminZone.id && (src.networkIds === null || src.networkIds.includes(adminNet.id));
  const zoneOfTargetIp = (ip: string): ZbfZone | undefined => {
    const net = allNetworks.find((n) => n.subnet && ipInCidr(ip, n.subnet));
    return net ? zoneOfNet(net.id) : undefined;
  };
  // ALLOWs sit above the BLOCKs: a target the admin's network is explicitly
  // allowed to reach stays reachable even when a later BLOCK covers it.
  const protectedIps = new Set(
    policies
      .filter((p) => p.action === "ALLOW" && p.destination.ip && covers(p.source))
      .map((p) => p.destination.ip as string),
  );

  const warnings: string[] = [];
  let blocked = false;
  for (const p of policies) {
    if (p.action !== "BLOCK" || !covers(p.source)) continue;
    const hitTargets = targetIps.filter(
      (t) =>
        !protectedIps.has(t) &&
        (p.destination.ip ? p.destination.ip === t : zoneOfTargetIp(t)?.id === p.destination.zoneId),
    );
    if (hitTargets.length > 0) {
      blocked = true;
      warnings.push(
        `REFUSED — your IP ${adminIp} is in ${p.source.label}, and “${p.name}” would cut this very session off from the portal (${hitTargets.join(", ")}). Tick your own network, or apply from a network that keeps access.`,
      );
    } else {
      warnings.push(
        `Your IP ${adminIp} is in ${p.source.label}: “${p.name}” will cut you off from ${p.destination.label} after applying.`,
      );
    }
  }
  if (!blocked && warnings.length === 0) {
    warnings.push(
      `Lockout check passed: your IP ${adminIp} (${adminNet.name}, zone “${adminZone.name}”) is not matched by any BLOCK policy's source, so applying cannot sever this session.`,
    );
  }
  return { blocked, warnings, adminIp };
}

// Local copies of the range helpers (runtime originals in firewallPlan.ts) —
// same test-runner constraint as the IP helpers above.
function rangeOf(addr: string): { lo: number; hi: number } | null {
  const [base, bitsStr] = addr.split("/");
  const a = ipToInt(base ?? "");
  if (a == null) return null;
  if (bitsStr === undefined) return { lo: a, hi: a };
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  const lo = (a & mask) >>> 0;
  return { lo, hi: (lo + (2 ** (32 - bits) - 1)) >>> 0 };
}

function overlaps(a: { lo: number; hi: number }, b: { lo: number; hi: number } | null): boolean {
  return !!b && a.lo <= b.hi && b.lo <= a.hi;
}

/** An endpoint covers an address range when its single IP overlaps it, or
 * when any subnet of its named networks (whole zone for zone-ANY) does. */
function endpointCovers(
  e: PolicyEndpoint,
  range: { lo: number; hi: number },
  allNetworks: PlanNetwork[],
  zones: ZbfZone[],
): boolean {
  if (e.ip) return overlaps(range, rangeOf(e.ip));
  const zone = zones.find((z) => z.id === e.zoneId);
  const netIds = e.networkIds ?? zone?.networkIds ?? [];
  return allNetworks.some(
    (n) => netIds.includes(n.id) && n.subnet && overlaps(range, rangeOf(n.subnet)),
  );
}

/**
 * Which critical entries each planned BLOCK holds in its SOURCE, one array
 * per policy, parallel to `policies` (empty for ALLOWs and clean BLOCKs).
 * Lets an apply dialog flag exactly the blocks that would cut a critical
 * device off from the block's destination, so the operator can untick those
 * instead of the whole apply being refused.
 */
export function zbfCriticalSourceHits(
  policies: PlannedPolicy[],
  entries: CriticalEntry[],
  allNetworks: PlanNetwork[],
  zones: ZbfZone[],
): string[][] {
  return policies.map((p) =>
    p.action !== "BLOCK"
      ? []
      : entries.filter((e) => endpointCovers(p.source, e, allNetworks, zones)).map((e) => e.raw),
  );
}

/**
 * Judge the zone-based plan against the critical-address list — the ZBF twin
 * of assessCriticalAddresses. An endpoint covers an address when its single
 * IP overlaps it, or when any subnet of its named networks (or of the whole
 * zone, for zone-ANY endpoints) does.
 */
export function assessZbfCritical(
  policies: PlannedPolicy[],
  entries: CriticalEntry[],
  allNetworks: PlanNetwork[],
  zones: ZbfZone[],
): CriticalAssessment {
  const covers = (e: PolicyEndpoint, range: { lo: number; hi: number }): boolean =>
    endpointCovers(e, range, allNetworks, zones);

  const verdicts: CriticalVerdict[] = entries.map((e) => {
    const blocks = policies.filter((p) => p.action === "BLOCK");
    const cutOff = blocks.filter((p) => covers(p.source, e));
    const blockedTo = blocks.filter((p) => covers(p.destination, e));
    if (cutOff.length > 0) {
      return {
        address: e.raw,
        status: "cut-off" as const,
        detail: `“${cutOff[0].name}”${cutOff.length > 1 ? ` (+${cutOff.length - 1} more)` : ""} has ${e.raw} inside its source — the device loses its path to ${cutOff[0].destination.label}. Untick that block (or its source network), adjust the critical list, or move the device off that network.`,
      };
    }
    if (blockedTo.length > 0) {
      const allowsTo = policies.filter((p) => p.action === "ALLOW" && covers(p.destination, e));
      if (allowsTo.length > 0 && e.allow === "all") {
        return {
          address: e.raw,
          status: "safe" as const,
          detail: `Allowed above the blocks (“${allowsTo[0].name}”) — guests keep full reach.`,
        };
      }
      if (allowsTo.length > 0) {
        return {
          address: e.raw,
          status: "blocked-to" as const,
          detail: `Allowed above the blocks on the declared port(s) (“${allowsTo[0].name}”); other guest traffic to ${e.raw} stays blocked — usually exactly right for infrastructure.`,
        };
      }
      return {
        address: e.raw,
        status: "blocked-to" as const,
        detail: `${blockedTo.length} block(s) point AT ${e.raw} (first: “${blockedTo[0].name}”) — guests lose reach to it. Fine if intended; flag the entry with “allow through firewall” if guests need it.`,
      };
    }
    return { address: e.raw, status: "safe" as const, detail: "No planned block touches this address." };
  });
  return { blocked: verdicts.some((v) => v.status === "cut-off"), verdicts };
}

/**
 * The exact v2 firewall-policies wire shape for one planned policy — the one
 * place the payload lives, so the preview, the apply, and any 400 diagnostics
 * all describe the same object. Matching modes: whole zone = ANY; specific
 * networks = NETWORK + network_ids; single IP = IP + ips[] (live policies
 * show ips[] also accepts CIDRs, but we only ever put one host IP there).
 */
export function policyPayload(p: PlannedPolicy, index: number, name: string): Record<string, unknown> {
  // matching_target says WHAT kind of thing to match (IP/NETWORK/ANY);
  // matching_target_type says HOW it is given — SPECIFIC = inline values
  // (ips[]/network_ids[]) rather than a referenced object. Omitting it on a
  // non-ANY target is a 400: api.err.MissingFirewallDestinationMatchingTargetType
  // (seen live on an IP destination).
  const endpoint = (e: PolicyEndpoint) => ({
    zone_id: e.zoneId,
    matching_target: e.ip ? "IP" : e.networkIds ? "NETWORK" : "ANY",
    ...(e.ip || e.networkIds ? { matching_target_type: "SPECIFIC" } : {}),
    ...(e.ip ? { ips: [e.ip] } : {}),
    ...(e.networkIds ? { network_ids: e.networkIds } : {}),
    match_opposite_ips: false,
    port_matching_type: e.port ? "SPECIFIC" : "ANY",
    ...(e.port ? { port: e.port } : {}),
    match_opposite_ports: false,
  });
  return {
    name,
    enabled: true,
    action: p.action,
    predefined: false,
    protocol: p.protocol,
    connection_state_type: "ALL",
    connection_states: [],
    ip_version: "IPV4",
    index,
    logging: false,
    match_ip_sec: false,
    schedule: { mode: "ALWAYS", repeat_on_days: [], time_all_day: false },
    // "Allow respond traffic" defaults ON server-side and is invalid on a
    // BLOCK: api.err.FirewallPolicyCreateRespondTrafficPolicyNotAllowed
    // (seen live). ALLOWs create fine without the field — leave them be.
    ...(p.action === "BLOCK" ? { create_allow_respond: false } : {}),
    source: endpoint(p.source),
    destination: endpoint(p.destination),
  };
}
