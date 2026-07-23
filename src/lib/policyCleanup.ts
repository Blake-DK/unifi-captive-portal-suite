import type { PlanNetwork } from "./firewallPlan";
import type { ZbfZone } from "./zbfPlan";
import type { LiveClassicRule, LiveZbfPolicy } from "./pciCheck";

/**
 * Deletion-impact assessor for the firewall cleanup view — the mirror image
 * of the apply guards. Deleting a BLOCK only ever widens connectivity, but
 * deleting an ALLOW can silently hand a flow to a BLOCK sitting below it, so:
 *
 * - REFUSE (blocked=true) when, after the deletions, the requesting admin's
 *   own first-match flow to a portal target becomes a BLOCK — the same
 *   session-severing rule the apply refuses on.
 * - WARN for every deleted ALLOW whose (source, destination) overlaps a
 *   remaining enabled BLOCK — whatever that allow was shielding gets blocked.
 *
 * Pure/testable; same local IP-helper convention as the planners.
 */

export type DeletionAssessment = {
  blocked: boolean;
  warnings: string[];
  adminIp: string | null;
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

// --- ZBF endpoint coverage ---------------------------------------------------

function zoneOf(networks: PlanNetwork[], zones: ZbfZone[], ip: string): { zone: ZbfZone; net: PlanNetwork } | null {
  const net = networks.find((n) => n.subnet && overlaps(rangeOf(ip), rangeOf(n.subnet)));
  if (!net) return null;
  const zone = zones.find((z) => z.networkIds.includes(net.id));
  return zone ? { zone, net } : null;
}

/** Does a live policy endpoint cover this single IP? */
function zbfEndpointCoversIp(
  ep: Record<string, unknown> | undefined,
  ip: string,
  networks: PlanNetwork[],
  zones: ZbfZone[],
): boolean {
  if (!ep) return false;
  const home = zoneOf(networks, zones, ip);
  if (!home || ep.zone_id !== home.zone.id) return false;
  const target = (ep.matching_target as string | undefined) ?? "ANY";
  if (target === "ANY") return true;
  if (target === "NETWORK") {
    const ids = ep.network_ids;
    return Array.isArray(ids) && ids.includes(home.net.id);
  }
  if (target === "IP") {
    const ips = ep.ips;
    return Array.isArray(ips) && ips.some((i) => typeof i === "string" && overlaps(rangeOf(i), rangeOf(ip)));
  }
  return false;
}

/** Do two live ZBF endpoints overlap (could match the same host)? */
function zbfEndpointsOverlap(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
  networks: PlanNetwork[],
): boolean {
  if (!a || !b) return false;
  if (a.zone_id !== b.zone_id) return false;
  const ta = (a.matching_target as string | undefined) ?? "ANY";
  const tb = (b.matching_target as string | undefined) ?? "ANY";
  if (ta === "ANY" || tb === "ANY") return true;
  const idsA = Array.isArray(a.network_ids) ? (a.network_ids as string[]) : null;
  const idsB = Array.isArray(b.network_ids) ? (b.network_ids as string[]) : null;
  const ipsA = Array.isArray(a.ips) ? (a.ips as string[]) : null;
  const ipsB = Array.isArray(b.ips) ? (b.ips as string[]) : null;
  const netRanges = (ids: string[]) =>
    networks.filter((n) => ids.includes(n.id) && n.subnet).map((n) => rangeOf(n.subnet as string));
  const rangesA = idsA ? netRanges(idsA) : ipsA ? ipsA.map(rangeOf) : [];
  const rangesB = idsB ? netRanges(idsB) : ipsB ? ipsB.map(rangeOf) : [];
  if (idsA && idsB) return idsA.some((id) => idsB.includes(id));
  return rangesA.some((ra) => rangesB.some((rb) => overlaps(ra ?? null, rb ?? null)));
}

// --- the assessment ----------------------------------------------------------

export type DeletionInput = {
  /** Everything currently on the controller (enabled or not). */
  live: { policies: LiveZbfPolicy[] | null; rules: LiveClassicRule[] | null };
  /** Names of the entries being deleted (matched by _id upstream; names here
   * are only for warning texts). */
  deletedIds: Set<string>;
  /** id accessor — _id on both live shapes. */
  idOf: (p: LiveZbfPolicy | LiveClassicRule) => string | undefined;
  adminIp: string | null;
  targetIps: string[];
  networks: PlanNetwork[];
  zones: ZbfZone[] | null;
};

export function assessDeletion(input: DeletionInput): DeletionAssessment {
  const { live, deletedIds, idOf, adminIp, targetIps, networks, zones } = input;
  const warnings: string[] = [];
  let blocked = false;

  if (live.policies && zones) {
    const all = live.policies.filter((p) => p.enabled !== false);
    const remaining = all.filter((p) => !deletedIds.has(idOf(p) ?? ""));
    const deleted = all.filter((p) => deletedIds.has(idOf(p) ?? ""));
    // Engine order: custom policies before the predefined zone defaults.
    const ordered = [...remaining].sort((a, b) => {
      const pa = a.predefined === true ? 1 : 0;
      const pb = b.predefined === true ? 1 : 0;
      return pa - pb || (a.index ?? 0) - (b.index ?? 0);
    });

    // Admin-session guard: first remaining match for admin → each target.
    if (adminIp && isValidIp(adminIp)) {
      for (const t of targetIps) {
        const first = ordered.find(
          (p) =>
            zbfEndpointCoversIp(p.source, adminIp, networks, zones) &&
            zbfEndpointCoversIp(p.destination, t, networks, zones),
        );
        if (first && (first.action ?? "").toUpperCase() !== "ALLOW") {
          blocked = true;
          warnings.push(
            `REFUSED — after these deletions, “${first.name ?? "(unnamed)"}” becomes the first match for your IP ${adminIp} → ${t} and it is a ${first.action}. This very session would lose the portal.`,
          );
        }
      }
    } else if (deleted.some((p) => (p.action ?? "").toUpperCase() === "ALLOW")) {
      warnings.push(
        "Your client IP could not be determined, so the session-severing check cannot vouch for deleting these allows.",
      );
    }

    // Shielding warnings: a deleted ALLOW whose flow a remaining BLOCK overlaps.
    for (const d of deleted) {
      if ((d.action ?? "").toUpperCase() !== "ALLOW") continue;
      const shieldedFrom = remaining.find(
        (p) =>
          (p.action ?? "").toUpperCase() !== "ALLOW" &&
          zbfEndpointsOverlap(d.source, p.source, networks) &&
          zbfEndpointsOverlap(d.destination, p.destination, networks),
      );
      if (shieldedFrom) {
        warnings.push(
          `Deleting allow “${d.name ?? "(unnamed)"}” hands its traffic to remaining block “${shieldedFrom.name ?? "(unnamed)"}” — whatever that allow was keeping open gets blocked.`,
        );
      }
    }
  }

  if (live.rules) {
    const all = live.rules.filter((r) => r.enabled !== false);
    const remaining = all.filter((r) => !deletedIds.has(idOf(r) ?? ""));
    const deleted = all.filter((r) => deletedIds.has(idOf(r) ?? ""));
    const covers = (addr: string | undefined, ip: string) =>
      !addr || addr === "0.0.0.0/0" || overlaps(rangeOf(addr), rangeOf(ip));

    if (adminIp && isValidIp(adminIp)) {
      for (const t of targetIps) {
        // Overlap heuristic (classic ordering across rulesets isn't modeled):
        // a remaining drop covers admin→target and no remaining accept does.
        const drop = remaining.find(
          (r) => (r.action ?? "").toLowerCase() === "drop" && covers(r.src_address, adminIp) && covers(r.dst_address, t),
        );
        const accept = remaining.find(
          (r) => (r.action ?? "").toLowerCase() === "accept" && covers(r.src_address, adminIp) && covers(r.dst_address, t),
        );
        if (drop && !accept) {
          blocked = true;
          warnings.push(
            `REFUSED — after these deletions, “${drop.name ?? "(unnamed)"}” covers your IP ${adminIp} → ${t} with no accept left above it. This very session would lose the portal.`,
          );
        }
      }
    }

    for (const d of deleted) {
      if ((d.action ?? "").toLowerCase() !== "accept") continue;
      const shieldedFrom = remaining.find(
        (r) =>
          (r.action ?? "").toLowerCase() === "drop" &&
          rangesTouch(d.src_address, r.src_address) &&
          rangesTouch(d.dst_address, r.dst_address),
      );
      if (shieldedFrom) {
        warnings.push(
          `Deleting accept “${d.name ?? "(unnamed)"}” hands its traffic to remaining drop “${shieldedFrom.name ?? "(unnamed)"}”.`,
        );
      }
    }
  }

  if (!blocked && warnings.length === 0) {
    warnings.push("No remaining block takes over a deleted allow's flow, and your own session keeps the portal.");
  }
  return { blocked, warnings, adminIp };
}

/** Blank/any-address fields count as touching everything. */
function rangesTouch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || a === "0.0.0.0/0" || b === "0.0.0.0/0") return true;
  return overlaps(rangeOf(a), rangeOf(b));
}
