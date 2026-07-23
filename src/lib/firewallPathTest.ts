import type { PlanNetwork } from "./firewallPlan";
import type { ZbfZone } from "./zbfPlan";
import type { LiveClassicRule, LiveZbfPolicy } from "./pciCheck";

/**
 * Firewall path *simulator* — "if a host with this IP (on this network) talks
 * to that IP, what does the firewall do?" Answered against the LIVE policy
 * list, the same first-match-by-index walk the controller applies on
 * zone-based firewalls (classic controllers get an overlap heuristic, flagged
 * as such). Read-only and advisory: it models the policy table, not NAT,
 * routing, or the zone matrix's unexposed default action.
 *
 * Pure/testable; local IP helpers per the planner convention.
 */

export type PathTestInput = {
  srcIp: string;
  dstIp: string;
  /** Destination port; null/absent = "any traffic at all". */
  port?: string | null;
  /** null/absent = unspecified. */
  protocol?: "tcp" | "udp" | null;
  /** Explicit placements for IPs the controller can't resolve to a network
   * (hypothetical hosts) — network ids from the picker, or the sentinel
   * "internet" to force the WAN side. */
  srcNetworkId?: string | null;
  dstNetworkId?: string | null;
  networks: PlanNetwork[];
  zones: ZbfZone[] | null;
  /** The zone holding the WAN networks (zone-based engines) — lets a public
   * IP, or the "internet" sentinel, test LAN↔WAN flows. */
  internetZone?: ZbfZone | null;
  policies: LiveZbfPolicy[] | null;
  rules: LiveClassicRule[] | null;
};

export type PathTestResult = {
  verdict: "allowed" | "blocked" | "default" | "not-firewalled" | "unknown";
  /** The entry the verdict rests on, when one matched. */
  matched?: { name: string; action: string; index: number | string | null; port: string | null };
  src: { ip: string; network: string | null; zone: string | null };
  dst: { ip: string; network: string | null; zone: string | null };
  /** Port-restricted allows that would match this flow on specific ports —
   * reported when the test ran portless. */
  partialAllows: string[];
  notes: string[];
};

function isValidIp(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
}

function ipToInt(ip: string): number | null {
  if (!isValidIp(ip)) return null;
  const n = ip.trim().split(".").map(Number);
  return n[0] * 2 ** 24 + n[1] * 2 ** 16 + n[2] * 256 + n[3];
}

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

function overlaps(a: { lo: number; hi: number } | null, b: { lo: number; hi: number } | null): boolean {
  return !!a && !!b && a.lo <= b.hi && b.lo <= a.hi;
}

function isPrivateIp(ip: string): boolean {
  const n = ipToInt(ip);
  if (n == null) return false;
  return (
    (n >= ipToInt("10.0.0.0")! && n <= ipToInt("10.255.255.255")!) ||
    (n >= ipToInt("172.16.0.0")! && n <= ipToInt("172.31.255.255")!) ||
    (n >= ipToInt("192.168.0.0")! && n <= ipToInt("192.168.255.255")!)
  );
}

type Placement = { net: PlanNetwork | null; zone: ZbfZone | null };

function place(
  ip: string,
  overrideNetworkId: string | null | undefined,
  networks: PlanNetwork[],
  zones: ZbfZone[] | null,
): Placement {
  const net =
    (overrideNetworkId ? networks.find((n) => n.id === overrideNetworkId) : undefined) ??
    networks.find((n) => n.subnet && overlaps(rangeOf(ip), rangeOf(n.subnet))) ??
    null;
  const zone = net && zones ? zones.find((z) => z.networkIds.includes(net.id)) ?? null : null;
  return { net, zone };
}

/** Does a live ZBF endpoint cover this IP, placed on this network/zone? */
function epCovers(ep: Record<string, unknown> | undefined, ip: string, p: Placement): boolean {
  if (!ep || !p.zone) return false;
  if (ep.zone_id !== p.zone.id) return false;
  const target = (ep.matching_target as string | undefined) ?? "ANY";
  if (target === "ANY") return true;
  if (target === "NETWORK") {
    const ids = ep.network_ids;
    return Array.isArray(ids) && !!p.net && ids.includes(p.net.id);
  }
  if (target === "IP") {
    const ips = ep.ips;
    return Array.isArray(ips) && ips.some((i) => typeof i === "string" && overlaps(rangeOf(i), rangeOf(ip)));
  }
  return false;
}

/** Policy protocol vs the tested protocol (absent test protocol matches all). */
function protocolMatches(policyProto: string | undefined, test: "tcp" | "udp" | null | undefined): boolean {
  const p = (policyProto ?? "all").toLowerCase();
  if (p === "all" || !test) return true;
  if (p === "tcp_udp") return true;
  return p === test;
}

/** Policy destination port vs the tested port. Returns "match" | "skip"
 * (port-restricted, test is portless or a different port) | "na" (no
 * restriction). Handles single ports and comma lists. */
function portMatch(ep: Record<string, unknown> | undefined, testPort: string | null | undefined): "match" | "skip" | "na" {
  const restricted = ep?.port_matching_type === "SPECIFIC" || typeof ep?.port === "string";
  if (!restricted) return "na";
  if (!testPort) return "skip";
  const ports = String(ep?.port ?? "").split(",").map((x) => x.trim());
  return ports.includes(testPort) ? "match" : "skip";
}

export function testFirewallPath(input: PathTestInput): PathTestResult {
  const notes: string[] = [];
  const partialAllows: string[] = [];
  let src = place(input.srcIp, input.srcNetworkId, input.networks, input.zones);
  let dst = place(input.dstIp, input.dstNetworkId, input.networks, input.zones);

  // WAN-side placement (zone engines): the "internet" sentinel forces it; a
  // PUBLIC IP outside every LAN subnet gets it automatically. A private IP
  // that resolves nowhere stays an error — that is a typo, not the internet.
  if (input.internetZone) {
    const toInternet = (which: "source" | "destination", ip: string): Placement => {
      notes.push(`The ${which} ${ip} is treated as Internet (zone “${input.internetZone!.name}”).`);
      return { net: null, zone: input.internetZone! };
    };
    if (input.srcNetworkId === "internet" || (!src.net && isValidIp(input.srcIp) && !isPrivateIp(input.srcIp))) {
      src = toInternet("source", input.srcIp);
    }
    if (input.dstNetworkId === "internet" || (!dst.net && isValidIp(input.dstIp) && !isPrivateIp(input.dstIp))) {
      dst = toInternet("destination", input.dstIp);
    }
  }

  const resolved = (p: Placement) => ({ network: p.net?.name ?? null, zone: p.zone?.name ?? null });
  const base = {
    src: { ip: input.srcIp, ...resolved(src) },
    dst: { ip: input.dstIp, ...resolved(dst) },
    partialAllows,
    notes,
  };

  if (!isValidIp(input.srcIp) || !isValidIp(input.dstIp)) {
    notes.push("Both endpoints must be IPv4 addresses.");
    return { verdict: "unknown", ...base };
  }

  if (input.policies && input.zones) {
    if (!src.zone || !dst.zone) {
      notes.push(
        `${!src.zone ? input.srcIp : input.dstIp} is not inside any zoned network the controller knows — pick its network explicitly, or the zone policies cannot be evaluated.`,
      );
      return { verdict: "unknown", ...base };
    }
    if (src.zone.id === dst.zone.id) {
      notes.push(
        `Both ends sit in zone “${src.zone.name}” — traffic inside a zone is never firewalled, no policy applies.`,
      );
      return { verdict: "not-firewalled", ...base };
    }
    // Engine order: custom policies (by index) BEFORE the predefined
    // zone-matrix defaults — a default never outranks a custom policy.
    const ordered = input.policies
      .filter((p) => p.enabled !== false)
      .sort((a, b) => {
        const pa = a.predefined === true ? 1 : 0;
        const pb = b.predefined === true ? 1 : 0;
        return pa - pb || (a.index ?? 0) - (b.index ?? 0);
      });
    for (const p of ordered) {
      if (!epCovers(p.source, input.srcIp, src) || !epCovers(p.destination, input.dstIp, dst)) continue;
      if (!protocolMatches(p.protocol, input.protocol)) continue;
      const pm = portMatch(p.destination, input.port);
      if (pm === "skip") {
        if ((p.action ?? "").toUpperCase() === "ALLOW") {
          partialAllows.push(`${p.name ?? "(unnamed)"} (port ${String(p.destination?.port ?? "?")})`);
        }
        continue;
      }
      const action = (p.action ?? "").toUpperCase();
      return {
        verdict: action === "ALLOW" ? "allowed" : "blocked",
        matched: {
          name: `${p.name ?? "(unnamed policy)"}${p.predefined === true ? " (zone default)" : ""}`,
          action,
          index: p.index ?? null,
          port: typeof p.destination?.port === "string" ? (p.destination.port as string) : null,
        },
        ...base,
      };
    }
    notes.push(
      "No explicit policy matches this flow — the zone matrix's default action decides, which this check cannot read. Check Settings → Policy Engine in UniFi.",
    );
    return { verdict: "default", ...base };
  }

  if (input.rules) {
    if (src.net && dst.net && src.net.id === dst.net.id) {
      notes.push(`Both ends sit in “${src.net.name}” — same-network traffic never crosses the gateway firewall.`);
      return { verdict: "not-firewalled", ...base };
    }
    notes.push(
      "Classic engine: rule interleaving with UniFi's built-in chains is not exposed, so this is an overlap heuristic, not a strict simulation.",
    );
    for (const [which, ip, p] of [
      ["source", input.srcIp, src],
      ["destination", input.dstIp, dst],
    ] as const) {
      if (!p.net && !isPrivateIp(ip)) {
        notes.push(
          `The ${which} ${ip} is outside every LAN subnet — treated as WAN-bound; rules are matched by address overlap (WAN_IN/WAN_OUT interleaving is not modelled).`,
        );
      }
    }
    const covers = (addr: string | undefined, ip: string) =>
      !addr || addr === "0.0.0.0/0" || addr.toLowerCase() === "any" || overlaps(rangeOf(addr), rangeOf(ip));
    const relevant = input.rules
      .filter(
        (r) =>
          r.enabled !== false &&
          covers(r.src_address, input.srcIp) &&
          covers(r.dst_address, input.dstIp) &&
          protocolMatches(r.protocol, input.protocol),
      )
      .sort((a, b) => Number(a.rule_index ?? 0) - Number(b.rule_index ?? 0));
    for (const r of relevant) {
      if (r.dst_port) {
        if (!input.port) {
          if ((r.action ?? "").toLowerCase() === "accept") {
            partialAllows.push(`${r.name ?? "(unnamed)"} (port ${r.dst_port})`);
          }
          continue;
        }
        if (!r.dst_port.split(",").map((x) => x.trim()).includes(input.port)) continue;
      }
      const action = (r.action ?? "").toLowerCase();
      return {
        verdict: action === "accept" ? "allowed" : "blocked",
        matched: { name: r.name ?? "(unnamed rule)", action, index: r.rule_index ?? null, port: r.dst_port ?? null },
        ...base,
      };
    }
    notes.push("No user rule matches — the ruleset's default action decides.");
    return { verdict: "default", ...base };
  }

  notes.push("No firewall data to evaluate.");
  return { verdict: "unknown", ...base };
}
