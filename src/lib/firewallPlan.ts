/**
 * Firewall rule *planner* — advisory only. Given the networks an operator
 * ticks, the portal's LAN IP, and the reverse-proxy host's IP, it produces
 * the set of UniFi firewall rules that would let exactly those networks reach
 * the portal + proxy and nothing else. It NEVER writes to the controller: the
 * output is a reviewable list an operator applies by hand, because a wrong
 * firewall rule on a live gateway can cut the portal off the network or lock
 * out access — that call stays with a human.
 *
 * Pure/testable, like the alert evaluators. Rule ordering matters on UniFi
 * (allow before the guest-isolation drop), so each rule carries an explicit
 * `order` the UI renders in sequence.
 */

export type FirewallTarget = { name: string; ip: string };

/** Every rule/policy the portal writes carries this name prefix — it is how
 * re-applies skip existing entries and how the cleanup view tells ours apart. */
export const PORTAL_RULE_PREFIX = "Portal: ";

/** The exact name a planned rule/policy gets at apply time. */
export function portalRuleName(description: string, port?: string | null): string {
  return `${PORTAL_RULE_PREFIX}${description}${port ? ` :${port}` : ""}`.slice(0, 64);
}

export type PlanNetwork = {
  id: string;
  name: string;
  vlan?: number;
  subnet?: string; // CIDR, e.g. "10.91.0.0/21"
  isGuest?: boolean;
  /** DNS servers this network's DHCP hands out (dhcpd_dns_1..4) — lets the
   * zone planner keep DNS working across the isolation blocks. */
  dnsServers?: string[];
};

export type FirewallRule = {
  order: number;
  ruleset: string; // UniFi ruleset, e.g. "LAN_IN" / "GUEST_IN"
  action: "accept" | "drop";
  description: string;
  protocol: "tcp" | "udp" | "tcp_udp" | "icmp" | "all";
  source: string; // subnet or IP
  destination: string; // IP
  ports: string; // e.g. "80, 443" or "-"
};

export type FirewallPlan = {
  rules: FirewallRule[];
  notes: string[];
};

/** The portal serves plain HTTP on :80 (TLS terminates at the proxy). */
const PORTAL_PORTS = "80";
/** The reverse proxy (bundled/external Traefik) serves HTTP + HTTPS. */
const PROXY_PORTS = "80, 443";

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
 * reaches the portal via the WAN path, which LAN drops never touch. */
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
export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const a = ipToInt(ip);
  const b = ipToInt(base ?? "");
  if (a == null || b == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

export type LockoutAssessment = {
  /** Applying WOULD cut this admin session off from the portal — refuse. */
  blocked: boolean;
  warnings: string[];
  adminIp: string | null;
};

// --- Critical addresses ------------------------------------------------------
// Operator-declared IPs/CIDRs that must never lose connectivity (POS
// terminals, payment gateways, door controllers…). A plan whose drop/BLOCK
// SOURCE covers one is refusal-grade — the device itself would be cut off; a
// drop whose DESTINATION covers one is advisory — guests merely lose reach TO
// it, which is usually the intended isolation.

export type CriticalService = { port: string; proto: "tcp" | "udp" | "tcp_udp" };

export type CriticalEntry = {
  /** Full entry as stored, e.g. "10.90.0.1@53+123u+ping" or "10.0.30.0/24". */
  raw: string;
  /** Just the IP/CIDR part. */
  addr: string;
  lo: number;
  hi: number;
  /** Firewall-allow opt-in: null = guard-only; "all" = allow all traffic;
   * otherwise the enumerated services guests may reach, plus ping (ICMP). */
  allow: null | "all" | { services: CriticalService[]; ping: boolean };
};

export type CriticalVerdict = {
  address: string;
  status: "safe" | "cut-off" | "blocked-to";
  detail: string;
};

export type CriticalAssessment = {
  /** Some critical address would itself be cut off — refuse the apply. */
  blocked: boolean;
  verdicts: CriticalVerdict[];
};

/** Parse a comma/whitespace-separated list of IPs and CIDRs, each optionally
 * suffixed `@…` to also ALLOW it through the firewall: `@all` for every
 * port, or `+`-separated service tokens — a port (both protocols), a port
 * with a `t`/`u` suffix (tcp/udp only), or `ping` for ICMP. Example:
 * `10.90.0.1@53+123u+ping`. */
export function parseCriticalAddresses(text: string): { entries: CriticalEntry[]; invalid: string[] } {
  const entries: CriticalEntry[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean)) {
    const [addr, portSpec, ...extra] = raw.split("@");
    const r = rangeOf(addr);
    const allow = parseAllowSpec(portSpec);
    if (!r || extra.length > 0 || allow === undefined) {
      invalid.push(raw);
      continue;
    }
    entries.push({ raw, addr, ...r, allow });
  }
  return { entries, invalid };
}

/** undefined = invalid spec; null = no suffix (guard-only). */
function parseAllowSpec(
  spec: string | undefined,
): CriticalEntry["allow"] | undefined {
  if (spec === undefined) return null;
  if (spec === "all") return "all";
  const services: CriticalService[] = [];
  let ping = false;
  for (const tok of spec.split("+").map((p) => p.trim())) {
    if (tok === "ping") {
      ping = true;
      continue;
    }
    const m = /^(\d{1,5})([tu])?$/.exec(tok);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 65535) return undefined;
    services.push({ port: m[1], proto: m[2] === "t" ? "tcp" : m[2] === "u" ? "udp" : "tcp_udp" });
  }
  if (services.length === 0 && !ping) return undefined;
  return { services, ping };
}

/** Inclusive address range of an IP or CIDR, or null if unparseable. */
export function rangeOf(addr: string): { lo: number; hi: number } | null {
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

/**
 * Which critical entries each planned drop holds in its SOURCE, one array
 * per rule, parallel to `rules` (empty for accepts and clean drops); the
 * classic twin of zbfCriticalSourceHits. Lets an apply dialog flag exactly
 * the blocks that would cut a critical device off so the operator can untick
 * those instead of the whole apply being refused.
 */
export function criticalSourceHits(rules: FirewallRule[], entries: CriticalEntry[]): string[][] {
  return rules.map((r) =>
    r.action !== "drop" ? [] : entries.filter((e) => overlaps(e, rangeOf(r.source))).map((e) => e.raw),
  );
}

/**
 * Judge the classic plan against the critical-address list. Pure; the apply
 * route refuses (409) when `blocked`, mirroring the admin-lockout guard.
 */
export function assessCriticalAddresses(
  rules: FirewallRule[],
  entries: CriticalEntry[],
): CriticalAssessment {
  const verdicts: CriticalVerdict[] = entries.map((e) => {
    const cutOff = rules.filter((r) => r.action === "drop" && overlaps(e, rangeOf(r.source)));
    const blockedTo = rules.filter((r) => r.action === "drop" && overlaps(e, rangeOf(r.destination)));
    if (cutOff.length > 0) {
      return {
        address: e.raw,
        status: "cut-off",
        detail: `“${cutOff[0].description}”${cutOff.length > 1 ? ` (+${cutOff.length - 1} more)` : ""} has ${e.raw} inside its source — the device loses its path to ${cutOff[0].destination}. Untick that block (or its source network), adjust the critical list, or move the device off that network.`,
      };
    }
    if (blockedTo.length > 0) {
      const allowsTo = rules.filter((r) => r.action === "accept" && overlaps(e, rangeOf(r.destination)));
      if (allowsTo.length > 0 && e.allow === "all") {
        return {
          address: e.raw,
          status: "safe",
          detail: `Allowed above the blocks (“${allowsTo[0].description}”) — guests keep full reach.`,
        };
      }
      if (allowsTo.length > 0) {
        return {
          address: e.raw,
          status: "blocked-to",
          detail: `Allowed above the blocks on the declared port(s) (“${allowsTo[0].description}”); other guest traffic to ${e.raw} stays blocked — usually exactly right for infrastructure.`,
        };
      }
      return {
        address: e.raw,
        status: "blocked-to",
        detail: `${blockedTo.length} block(s) point AT ${e.raw} (first: “${blockedTo[0].description}”) — guests lose reach to it. Fine if intended; flag the entry with “allow through firewall” if guests need it.`,
      };
    }
    return { address: e.raw, status: "safe", detail: "No planned block touches this address." };
  });
  return { blocked: verdicts.some((v) => v.status === "cut-off"), verdicts };
}

/**
 * Lockout guard for the auto-apply: given the planned rules, the admin's own
 * client IP, and the portal/proxy target IPs, decide whether applying could
 * sever the very session doing the applying (blocked) or merely change what
 * the admin's network can reach (warnings). Drops are source-based: the risk
 * is the admin sitting INSIDE a drop rule's source subnet.
 */
export function assessLockout(
  rules: FirewallRule[],
  adminIp: string | null,
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
  const warnings: string[] = [];
  let blocked = false;
  // Accepts sit ABOVE the drops in the plan: a target the admin's own subnet
  // is explicitly allowed to reach stays reachable even when a later drop's
  // destination covers it.
  const protectedTargets = new Set(
    rules
      .filter((r) => r.action === "accept" && r.source.includes("/") && ipInCidr(adminIp, r.source))
      .map((r) => r.destination),
  );
  for (const r of rules) {
    if (r.action !== "drop" || !r.source.includes("/") || !ipInCidr(adminIp, r.source)) continue;
    const hitsPortal = targetIps.some(
      (t) =>
        !protectedTargets.has(t) &&
        (r.destination === t || (r.destination.includes("/") && ipInCidr(t, r.destination))),
    );
    if (hitsPortal) {
      blocked = true;
      warnings.push(
        `REFUSED — your IP ${adminIp} is inside ${r.source}, and “${r.description}” would cut this very session off from the portal (${r.destination}). Tick your own network, or apply from a network that keeps access.`,
      );
    } else {
      warnings.push(
        `Your IP ${adminIp} is inside ${r.source}: “${r.description}” will cut you off from ${r.destination} after applying.`,
      );
    }
  }
  if (!blocked && warnings.length === 0) {
    warnings.push(
      isPrivateIp(adminIp)
        ? `Lockout check passed: your IP ${adminIp} is not inside any drop rule's source subnet, so applying cannot sever this session.`
        : `Lockout check passed: your session arrives from the internet (${adminIp}) — LAN firewall drops cannot sever it.`,
    );
  }
  return { blocked, warnings, adminIp };
}

/**
 * Build the advisory rule set. `selected` are the networks allowed to reach
 * the targets; every *guest* network NOT selected gets an explicit drop to
 * the portal/proxy so ticking is opt-in, not opt-out. Corporate/other
 * networks are left alone (their reachability is the operator's existing
 * inter-VLAN policy — we don't presume to fence them).
 */
export function buildFirewallPlan(
  selected: PlanNetwork[],
  portal: FirewallTarget,
  proxy: FirewallTarget | null,
  allGuestNetworks: PlanNetwork[] = [],
  allNetworks: PlanNetwork[] = [],
  criticalAllows: CriticalEntry[] = [],
): FirewallPlan {
  const rules: FirewallRule[] = [];
  const notes: string[] = [];
  let order = 0;

  const targets: FirewallTarget[] = [portal];
  if (proxy && isValidIp(proxy.ip)) targets.push(proxy);
  else if (proxy && !isValidIp(proxy.ip)) {
    notes.push(
      `Reverse-proxy address "${proxy.ip}" is not an IP — resolve it to the LAN IP the gateway sees and add the matching rules by hand.`,
    );
  }

  if (!isValidIp(portal.ip)) {
    notes.push(`Portal address "${portal.ip}" is not an IP — set Proxy Target IP (Settings → URLs) so the rules can name it.`);
    return { rules, notes };
  }

  const portsFor = (t: FirewallTarget) => (t === portal ? PORTAL_PORTS : PROXY_PORTS);

  // Allow rules first — one per (selected network × target).
  for (const net of selected) {
    if (!net.subnet) {
      notes.push(`"${net.name}" has no subnet on the controller — skipped; add its rule manually.`);
      continue;
    }
    const ruleset = net.isGuest ? "GUEST_IN" : "LAN_IN";
    for (const t of targets) {
      rules.push({
        order: ++order,
        ruleset,
        action: "accept",
        description: `Allow ${net.name} → ${t.name}`,
        protocol: "tcp",
        source: net.subnet,
        destination: t.ip,
        ports: portsFor(t),
      });
    }
  }

  // Critical infrastructure the guests must keep reaching (DNS/DHCP servers…):
  // operator-flagged critical addresses become accepts ABOVE the drops, one
  // per guest network × declared service (@all = one every-port rule; ping =
  // its own ICMP rule).
  for (const e of criticalAllows) {
    if (!e.allow) continue;
    for (const g of allGuestNetworks) {
      if (!g.subnet) continue;
      // Same-subnet traffic never crosses the inter-VLAN drops — no rule needed.
      if (overlaps(e, rangeOf(g.subnet))) continue;
      const pushRule = (protocol: FirewallRule["protocol"], ports: string, tag = "") =>
        rules.push({
          order: ++order,
          ruleset: "GUEST_IN",
          action: "accept",
          description: `Allow ${g.name} → critical ${e.addr}${tag}`,
          protocol,
          source: g.subnet as string,
          destination: e.addr,
          ports,
        });
      if (e.allow === "all") {
        pushRule("all", "-");
        continue;
      }
      for (const s of e.allow.services) pushRule(s.proto, s.port);
      if (e.allow.ping) pushRule("icmp", "-", " (ping)");
    }
  }

  // Explicit drop for guest networks the operator did NOT tick — so isolation
  // is deliberate and visible, not merely implied by the default guest policy.
  const selectedIds = new Set(selected.map((n) => n.id));
  for (const net of allGuestNetworks) {
    if (selectedIds.has(net.id) || !net.subnet) continue;
    for (const t of targets) {
      rules.push({
        order: ++order,
        ruleset: "GUEST_IN",
        action: "drop",
        description: `Block ${net.name} → ${t.name}`,
        protocol: "all",
        source: net.subnet,
        destination: t.ip,
        ports: "-",
      });
    }
  }

  // Inter-VLAN isolation: guest networks must not reach ANY other network —
  // explicit subnet→subnet drops (after the portal/proxy accepts above) so
  // isolation doesn't silently rely on the controller's default guest policy.
  const guestIds = new Set(allGuestNetworks.map((n) => n.id));
  for (const g of allGuestNetworks) {
    if (!g.subnet) continue;
    for (const other of allNetworks) {
      if (other.id === g.id || !other.subnet || other.subnet === g.subnet) continue;
      rules.push({
        order: ++order,
        ruleset: "GUEST_IN",
        action: "drop",
        description: `Isolate ${g.name} — block inter-VLAN traffic to ${other.name}`,
        protocol: "all",
        source: g.subnet,
        destination: other.subnet,
        ports: "-",
      });
    }
  }
  if (allGuestNetworks.some((g) => g.subnet) && allNetworks.some((n) => !guestIds.has(n.id) && n.subnet)) {
    notes.push(
      "The inter-VLAN drops sit BELOW the accepts: guests reach the portal/proxy targets, then everything to the other networks is blocked. UniFi's guest purpose implies similar isolation — these rules make it explicit and cover networks whose purpose isn't set to guest.",
    );
  }

  if (rules.length > 0) {
    notes.push("Apply accept rules ABOVE any existing guest-isolation drop, in the order shown.");
    notes.push("These are a reviewed starting point, not auto-applied — confirm each against your topology in the UniFi console (Settings → Firewall & Security).");
  }
  return { rules, notes };
}
