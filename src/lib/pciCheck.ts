import type { FirewallRule, PlanNetwork } from "./firewallPlan";
import type { PlannedPolicy, PolicyEndpoint, ZbfZone } from "./zbfPlan";

/**
 * PCI/POS segmentation *checker* — read-only. Given the networks the operator
 * marked PCI-scoped (e.g. the Point-of-Sale VLAN) and the LIVE firewall state
 * (zone-based policies on UniFi Network 9+, classic rules otherwise), it
 * judges whether the firewall actually isolates them the way PCI DSS network
 * segmentation expects: nothing reaches the PCI network except enumerated,
 * documented services, and the PCI network's own egress is restricted.
 *
 * It never writes to the controller and it is NOT a compliance certification —
 * the verdicts say what the firewall config does, with the matching policy as
 * evidence, so an assessor's checklist can start from facts.
 *
 * Pure/testable like the planners; same local-IP-helper convention (the Node
 * test runner keeps cross-module imports type-only).
 */

export type PciSeverity = "pass" | "fail" | "warn" | "info";

export type PciCheckRow = {
  id: string;
  /** The PCI network this row is about. */
  networkId: string;
  networkName: string;
  severity: PciSeverity;
  title: string;
  detail: string;
  /** Name of the policy/rule the verdict rests on, when there is one. */
  evidence?: string;
};

/** Live zone-based policy, loosely typed straight off the v2 API. */
export type LiveZbfPolicy = {
  _id?: string;
  name?: string;
  index?: number;
  enabled?: boolean;
  action?: string;
  protocol?: string;
  predefined?: boolean;
  source?: Record<string, unknown>;
  destination?: Record<string, unknown>;
};

/** Live classic rule, loosely typed straight off /rest/firewallrule. */
export type LiveClassicRule = {
  _id?: string;
  name?: string;
  ruleset?: string;
  rule_index?: number | string;
  enabled?: boolean;
  action?: string;
  protocol?: string;
  src_address?: string;
  dst_address?: string;
  dst_port?: string;
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

// --- zone-based evaluation ---------------------------------------------------

/** Does a live policy endpoint cover the given network? */
function zbfEndpointCovers(
  ep: Record<string, unknown> | undefined,
  net: PlanNetwork,
  zoneOfNet: (id: string) => ZbfZone | undefined,
): boolean {
  if (!ep) return false;
  const zone = zoneOfNet(net.id);
  if (!zone || ep.zone_id !== zone.id) return false;
  const target = (ep.matching_target as string | undefined) ?? "ANY";
  if (target === "ANY") return true;
  if (target === "NETWORK") {
    const ids = ep.network_ids;
    return Array.isArray(ids) && ids.includes(net.id);
  }
  if (target === "IP") {
    const ips = ep.ips;
    if (!Array.isArray(ips) || !net.subnet) return false;
    const netRange = rangeOf(net.subnet);
    return ips.some((ip) => typeof ip === "string" && overlaps(rangeOf(ip), netRange));
  }
  return false;
}

/** Is a live ALLOW narrow (specific port and/or single-IP destination)? */
function zbfAllowIsNarrow(p: LiveZbfPolicy): boolean {
  const dst = p.destination ?? {};
  const portSpecific = dst.port_matching_type === "SPECIFIC" || typeof dst.port === "string";
  const singleIp = dst.matching_target === "IP";
  return portSpecific || singleIp;
}

type FlowVerdict =
  | { kind: "blocked"; evidence: string; predefined?: boolean }
  | { kind: "allowed-broad"; evidence: string; predefined?: boolean }
  | { kind: "allowed-narrow"; evidence: string; predefined?: boolean }
  | { kind: "default" };

/** The engine's evaluation order: CUSTOM policies (by index) first, then the
 * predefined zone-matrix defaults — a zone default never outranks a custom
 * policy regardless of its index value (confirmed against a live controller
 * where the "Allow All Traffic" defaults carry low indexes). */
export function orderZbfPolicies(policies: LiveZbfPolicy[]): LiveZbfPolicy[] {
  return [...policies]
    .filter((p) => p.enabled !== false)
    .sort((a, b) => {
      const pa = a.predefined === true ? 1 : 0;
      const pb = b.predefined === true ? 1 : 0;
      return pa - pb || (a.index ?? 0) - (b.index ?? 0);
    });
}

/** First-match walk of the live policies for the flow from → to. */
function zbfFlowVerdict(
  policies: LiveZbfPolicy[],
  from: PlanNetwork,
  to: PlanNetwork,
  zoneOfNet: (id: string) => ZbfZone | undefined,
): FlowVerdict {
  for (const p of orderZbfPolicies(policies)) {
    if (!zbfEndpointCovers(p.source, from, zoneOfNet) || !zbfEndpointCovers(p.destination, to, zoneOfNet)) {
      continue;
    }
    const name = p.name ?? "(unnamed policy)";
    const predefined = p.predefined === true;
    if ((p.action ?? "").toUpperCase() === "BLOCK" || (p.action ?? "").toUpperCase() === "REJECT") {
      return { kind: "blocked", evidence: name, predefined };
    }
    return zbfAllowIsNarrow(p)
      ? { kind: "allowed-narrow", evidence: name, predefined }
      : { kind: "allowed-broad", evidence: name, predefined };
  }
  return { kind: "default" };
}

// --- classic evaluation ------------------------------------------------------

/** Does a classic address field cover the network? Blank/0.0.0.0/0 = any. */
function classicCovers(addr: string | undefined, net: PlanNetwork): boolean {
  if (!net.subnet) return false;
  if (!addr || addr === "0.0.0.0/0" || addr.toLowerCase() === "any") return true;
  return overlaps(rangeOf(addr), rangeOf(net.subnet));
}

function classicFlowVerdict(rules: LiveClassicRule[], from: PlanNetwork, to: PlanNetwork): FlowVerdict {
  // Classic rulesets interleave with UniFi's built-in chains in ways the API
  // doesn't expose, so this is overlap-based rather than a strict first-match
  // walk: an explicit drop counts as blocked unless an accept for the same
  // flow sits at a LOWER index in the same ruleset.
  const relevant = rules
    .filter((r) => r.enabled !== false && classicCovers(r.src_address, from) && classicCovers(r.dst_address, to))
    .sort((a, b) => Number(a.rule_index ?? 0) - Number(b.rule_index ?? 0));
  const first = relevant[0];
  if (!first) return { kind: "default" };
  const name = first.name ?? "(unnamed rule)";
  if ((first.action ?? "").toLowerCase() === "drop" || (first.action ?? "").toLowerCase() === "reject") {
    return { kind: "blocked", evidence: name };
  }
  return first.dst_port
    ? { kind: "allowed-narrow", evidence: name }
    : { kind: "allowed-broad", evidence: name };
}

// --- the check ---------------------------------------------------------------

export type PciCheckInput = {
  pciNetworkIds: string[];
  /** Non-WAN networks, same shape the planners use. */
  networks: PlanNetwork[];
  /** Zones on ZBF controllers, null on classic. */
  zones: ZbfZone[] | null;
  /** Live zone-based policies (ZBF) — null on classic. */
  policies: LiveZbfPolicy[] | null;
  /** Live classic rules — null on ZBF. */
  rules: LiveClassicRule[] | null;
};

export function checkPciSegmentation(input: PciCheckInput): PciCheckRow[] {
  const { networks, zones } = input;
  const rows: PciCheckRow[] = [];
  const pciNets = networks.filter((n) => input.pciNetworkIds.includes(n.id));
  const pciIds = new Set(pciNets.map((n) => n.id));
  const zoneOfNet = (id: string): ZbfZone | undefined => zones?.find((z) => z.networkIds.includes(id));

  if (pciNets.length === 0) return rows;

  const flowVerdict = (from: PlanNetwork, to: PlanNetwork): FlowVerdict =>
    input.policies
      ? zbfFlowVerdict(input.policies, from, to, zoneOfNet)
      : input.rules
        ? classicFlowVerdict(input.rules, from, to)
        : { kind: "default" };

  for (const pci of pciNets) {
    const others = networks.filter((n) => n.id !== pci.id && !pciIds.has(n.id));

    // Zone hygiene (ZBF only): traffic inside a zone is not firewalled, so a
    // PCI network sharing its zone with non-PCI networks cannot be segmented
    // by any policy — that sinks every other verdict.
    if (zones) {
      const zone = zoneOfNet(pci.id);
      if (!zone) {
        rows.push({
          id: `zone-none-${pci.id}`,
          networkId: pci.id,
          networkName: pci.name,
          severity: "fail",
          title: "Not assigned to any firewall zone",
          detail: `"${pci.name}" belongs to no zone, so no zone policy governs it. Assign it a dedicated zone (Settings → Policy Engine → Zones).`,
        });
      } else {
        const roommates = networks.filter(
          (n) => n.id !== pci.id && !pciIds.has(n.id) && zoneOfNet(n.id)?.id === zone.id,
        );
        if (roommates.length > 0) {
          rows.push({
            id: `zone-mixed-${pci.id}`,
            networkId: pci.id,
            networkName: pci.name,
            severity: "fail",
            title: `Shares zone “${zone.name}” with non-PCI networks`,
            detail: `Traffic inside a zone is not firewalled, so ${roommates.map((n) => n.name).join(", ")} can reach "${pci.name}" unfiltered. Move the PCI network to a dedicated zone — no policy can fix this.`,
          });
        } else {
          rows.push({
            id: `zone-ok-${pci.id}`,
            networkId: pci.id,
            networkName: pci.name,
            severity: "pass",
            title: `Dedicated zone “${zone.name}”`,
            detail: "The PCI network shares its zone with no non-PCI network, so zone policies govern all traffic in and out.",
          });
        }
      }
    }

    // Inbound: every other network → PCI, first-match verdicts aggregated.
    // Predefined (zone-matrix default) broad allows are split out: they ARE
    // fixable — custom policies evaluate before them, so Apply fixes can put
    // an explicit block on top.
    const inbound = others.map((o) => ({ net: o, v: flowVerdict(o, pci) }));
    const inBroadDefault = inbound.filter((x) => x.v.kind === "allowed-broad" && x.v.predefined);
    const inBroad = inbound.filter((x) => x.v.kind === "allowed-broad" && !x.v.predefined);
    const inNarrow = inbound.filter((x) => x.v.kind === "allowed-narrow");
    const inDefault = inbound.filter((x) => x.v.kind === "default");
    const inBlocked = inbound.filter((x) => x.v.kind === "blocked");
    if (inBroadDefault.length > 0) {
      rows.push({
        id: `in-zonedefault-${pci.id}`,
        networkId: pci.id,
        networkName: pci.name,
        severity: "fail",
        title: `Zone-matrix default allows ${inBroadDefault.map((x) => x.net.name).join(", ")} into "${pci.name}"`,
        detail: "The zone pair's default action is Allow, so everything gets through. Apply fixes places explicit blocks above the default; consider also flipping the pair to Block in UniFi (Settings → Policy Engine → Zone Matrix).",
        evidence: (inBroadDefault[0].v as { evidence: string }).evidence,
      });
    }
    if (inBroad.length > 0) {
      rows.push({
        id: `in-broad-${pci.id}`,
        networkId: pci.id,
        networkName: pci.name,
        severity: "fail",
        title: `Broad allow INTO "${pci.name}" from ${inBroad.map((x) => x.net.name).join(", ")}`,
        detail: "An unrestricted allow (any port, whole network) reaches the PCI network — PCI DSS 1.3 expects inbound traffic limited to enumerated, necessary services.",
        evidence: (inBroad[0].v as { evidence: string }).evidence,
      });
    }
    if (inNarrow.length > 0) {
      rows.push({
        id: `in-narrow-${pci.id}`,
        networkId: pci.id,
        networkName: pci.name,
        severity: "info",
        title: `Port/host-restricted allows into "${pci.name}" from ${inNarrow.map((x) => x.net.name).join(", ")}`,
        detail: "Enumerated exceptions are how PCI expects necessary services to be allowed — verify each is documented and still needed.",
        evidence: (inNarrow[0].v as { evidence: string }).evidence,
      });
    }
    if (inDefault.length > 0) {
      rows.push({
        id: `in-default-${pci.id}`,
        networkId: pci.id,
        networkName: pci.name,
        severity: "warn",
        title: `No explicit policy from ${inDefault.map((x) => x.net.name).join(", ")} into "${pci.name}"`,
        detail: zones
          ? "These flows fall through to the zone matrix's default action, which this check cannot read. Add explicit BLOCK policies so isolation is deliberate and auditable."
          : "No rule covers these flows — they fall through to the default policy. Add explicit drops so isolation is deliberate and auditable.",
      });
    }
    if (inBlocked.length > 0) {
      rows.push({
        id: `in-blocked-${pci.id}`,
        networkId: pci.id,
        networkName: pci.name,
        severity: "pass",
        title: `Blocked into "${pci.name}" from ${inBlocked.length} network(s)`,
        detail: `${inBlocked.map((x) => x.net.name).join(", ")} — explicitly blocked from the PCI network.`,
        evidence: (inBlocked[0].v as { evidence: string }).evidence,
      });
    }

    // Egress: PCI → every other network. Broad egress is a warn, not a fail —
    // PCI wants it restricted, but the cardholder-data flow direction matters
    // less than inbound exposure.
    const outbound = others.map((o) => ({ net: o, v: flowVerdict(pci, o) }));
    const outBroadDefault = outbound.filter((x) => x.v.kind === "allowed-broad" && x.v.predefined);
    const outBroad = outbound.filter((x) => x.v.kind === "allowed-broad" && !x.v.predefined);
    const outDefault = outbound.filter((x) => x.v.kind === "default");
    if (outBroadDefault.length > 0) {
      rows.push({
        id: `out-zonedefault-${pci.id}`,
        networkId: pci.id,
        networkName: pci.name,
        severity: "warn",
        title: `Zone-matrix default lets "${pci.name}" reach ${outBroadDefault.map((x) => x.net.name).join(", ")}`,
        detail: "Egress rides the zone pair's default Allow. Apply fixes places explicit blocks above it; consider flipping the pair in the UniFi Zone Matrix.",
        evidence: (outBroadDefault[0].v as { evidence: string }).evidence,
      });
    }
    if (outBroad.length > 0) {
      rows.push({
        id: `out-broad-${pci.id}`,
        networkId: pci.id,
        networkName: pci.name,
        severity: "warn",
        title: `"${pci.name}" has unrestricted egress to ${outBroad.map((x) => x.net.name).join(", ")}`,
        detail: "PCI DSS expects outbound traffic from the cardholder environment restricted to what the POS actually needs. Replace broad allows with per-service ones.",
        evidence: (outBroad[0].v as { evidence: string }).evidence,
      });
    }
    if (outDefault.length > 0) {
      rows.push({
        id: `out-default-${pci.id}`,
        networkId: pci.id,
        networkName: pci.name,
        severity: "warn",
        title: `No explicit egress policy from "${pci.name}" to ${outDefault.map((x) => x.net.name).join(", ")}`,
        detail: "Egress falls through to the default action. Make it explicit — allow the needed services, block the rest.",
      });
    }
    if (outbound.length > 0 && outBroad.length === 0 && outBroadDefault.length === 0 && outDefault.length === 0) {
      rows.push({
        id: `out-ok-${pci.id}`,
        networkId: pci.id,
        networkName: pci.name,
        severity: "pass",
        title: `Egress from "${pci.name}" is explicit`,
        detail: "Every flow out of the PCI network hits an explicit block or an enumerated allow.",
      });
    }

    // Internet egress can't be judged from LAN-side policies.
    rows.push({
      id: `wan-note-${pci.id}`,
      networkId: pci.id,
      networkName: pci.name,
      severity: "info",
      title: "Internet egress not evaluated",
      detail: `This check covers LAN segmentation only. Restrict "${pci.name}"'s internet egress to the payment processor's endpoints (gateway/zone-matrix rules to WAN).`,
    });
  }

  return rows;
}

// --- Apply-fixes plan ---------------------------------------------------------

export type PciFixPlan = {
  /** Zone-based fixes (empty on classic engines). */
  policies: PlannedPolicy[];
  /** Classic fixes (empty on ZBF engines). */
  rules: FirewallRule[];
  /** Findings that CANNOT be fixed by adding policies, with what to do instead. */
  unfixable: string[];
  /** Optional follow-ups that don't block the fix (e.g. flip a zone default). */
  notes: string[];
};

/**
 * Plan the remediations the portal can safely write: an explicit BLOCK for
 * every flow into/out of a PCI network that currently falls through to the
 * default action — OR that is allowed only by a PREDEFINED zone-matrix
 * default, which custom policies outrank. Deliberately NOT planned:
 * zone-mixing (needs a zone reassignment in UniFi — no policy can compensate)
 * and CUSTOM broad allows (a new block below a custom allow loses the
 * first-match walk; the allow itself must be narrowed or deleted). Those come
 * back as `unfixable` guidance.
 */
export function planPciFixes(input: PciCheckInput): PciFixPlan {
  const { networks, zones } = input;
  const policies: PlannedPolicy[] = [];
  const rules: FirewallRule[] = [];
  const unfixable: string[] = [];
  const notes: string[] = [];
  let order = 0;
  const noteOnce = (n: string) => {
    if (!notes.includes(n)) notes.push(n);
  };

  const pciNets = networks.filter((n) => input.pciNetworkIds.includes(n.id));
  const pciIds = new Set(pciNets.map((n) => n.id));
  const zoneOfNet = (id: string): ZbfZone | undefined => zones?.find((z) => z.networkIds.includes(id));
  const netEndpoint = (net: PlanNetwork, zone: ZbfZone): PolicyEndpoint => ({
    zoneId: zone.id,
    zoneName: zone.name,
    networkIds: [net.id],
    ip: null,
    port: null,
    label: net.name,
  });

  const flowVerdict = (from: PlanNetwork, to: PlanNetwork): FlowVerdict =>
    input.policies
      ? zbfFlowVerdict(input.policies, from, to, zoneOfNet)
      : input.rules
        ? classicFlowVerdict(input.rules, from, to)
        : { kind: "default" };

  for (const pci of pciNets) {
    const pciZone = zoneOfNet(pci.id);
    if (zones) {
      if (!pciZone) {
        unfixable.push(
          `"${pci.name}" belongs to no firewall zone — assign it a dedicated zone in UniFi first; no policy can be written without one.`,
        );
        continue;
      }
      const roommates = networks.filter(
        (n) => n.id !== pci.id && !pciIds.has(n.id) && zoneOfNet(n.id)?.id === pciZone.id,
      );
      if (roommates.length > 0) {
        unfixable.push(
          `"${pci.name}" shares zone “${pciZone.name}” with ${roommates.map((n) => n.name).join(", ")} — intra-zone traffic cannot be firewalled; move the PCI network to its own zone in UniFi (Settings → Policy Engine → Zones).`,
        );
      }
    }

    for (const other of networks) {
      if (other.id === pci.id || pciIds.has(other.id)) continue;
      const otherZone = zoneOfNet(other.id);
      if (zones && (!otherZone || !pciZone)) {
        if (!otherZone) unfixable.push(`"${other.name}" belongs to no firewall zone — its PCI blocks must be added by hand.`);
        continue;
      }
      if (zones && otherZone!.id === pciZone!.id) continue; // roommate — already reported

      // A flow is block-fixable when nothing explicit decides it: it falls to
      // the default action, or its only match is a PREDEFINED zone-matrix
      // default allow (custom policies evaluate first, so our block wins).
      const blockFixable = (v: FlowVerdict): boolean =>
        v.kind === "default" || (v.kind === "allowed-broad" && v.predefined === true);

      const vIn = flowVerdict(other, pci);
      if (vIn.kind === "allowed-broad" && !vIn.predefined) {
        unfixable.push(
          `Broad allow “${vIn.evidence}” lets ${other.name} into "${pci.name}" — a new block below it would not win the first-match walk. Narrow or delete that policy (see Current firewall entries).`,
        );
      } else if (blockFixable(vIn)) {
        if (vIn.kind === "allowed-broad") {
          noteOnce(
            `Some flows are open only via the zone-matrix DEFAULT allow (“${vIn.evidence}”) — the planned blocks outrank it; you can also flip those pairs to Block in UniFi (Settings → Policy Engine → Zone Matrix).`,
          );
        }
        if (zones) {
          policies.push({
            order: ++order,
            action: "BLOCK",
            name: `Block ${other.name} → PCI ${pci.name}`,
            protocol: "all",
            source: netEndpoint(other, otherZone!),
            destination: netEndpoint(pci, pciZone!),
          });
        } else if (other.subnet && pci.subnet) {
          rules.push({
            order: ++order,
            ruleset: other.isGuest ? "GUEST_IN" : "LAN_IN",
            action: "drop",
            description: `Block ${other.name} → PCI ${pci.name}`,
            protocol: "all",
            source: other.subnet,
            destination: pci.subnet,
            ports: "-",
          });
        }
      }

      const vOut = flowVerdict(pci, other);
      if (vOut.kind === "allowed-broad" && !vOut.predefined) {
        unfixable.push(
          `Broad allow “${vOut.evidence}” lets "${pci.name}" reach ${other.name} unrestricted — narrow or delete that policy; PCI egress should enumerate what the POS needs.`,
        );
      } else if (blockFixable(vOut)) {
        if (vOut.kind === "allowed-broad") {
          noteOnce(
            `Some flows are open only via the zone-matrix DEFAULT allow (“${vOut.evidence}”) — the planned blocks outrank it; you can also flip those pairs to Block in UniFi (Settings → Policy Engine → Zone Matrix).`,
          );
        }
        if (zones) {
          policies.push({
            order: ++order,
            action: "BLOCK",
            name: `Block PCI ${pci.name} → ${other.name}`,
            protocol: "all",
            source: netEndpoint(pci, pciZone!),
            destination: netEndpoint(other, otherZone!),
          });
        } else if (other.subnet && pci.subnet) {
          rules.push({
            order: ++order,
            ruleset: "LAN_IN",
            action: "drop",
            description: `Block PCI ${pci.name} → ${other.name}`,
            protocol: "all",
            source: pci.subnet,
            destination: other.subnet,
            ports: "-",
          });
        }
      }
    }
  }

  return { policies, rules, unfixable, notes };
}
