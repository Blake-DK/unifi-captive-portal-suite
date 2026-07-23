/**
 * Verdict logic for the "no network path to the guest container" separation
 * check (System Health panel). Pure — the DNS lookup and HTTP probe happen in
 * systemHealth.ts; this module only classifies their results.
 *
 * The subtlety that makes this more than "did an HTTP GET succeed": Docker's
 * embedded DNS forwards names it doesn't know to the HOST's resolver,
 * including the host's /etc/hosts — and a Debian-style host named "portal"
 * maps its own name to 127.0.1.1 there. From the admin container that answer
 * connects back to the admin container ITSELF (the server binds 0.0.0.0), so
 * a bare probe of http://portal:3000 returns 200 without any shared network
 * (seen live on the first split host). Only an answer from a genuinely
 * foreign address is evidence of a breach.
 */

const isLoopback = (addr: string) => {
  const a = addr.startsWith("::ffff:") ? addr.slice(7) : addr;
  return a.startsWith("127.") || a === "::1";
};

/** Addresses that are neither loopback nor one of this container's own. */
export function foreignAddrs(resolved: string[], ownAddrs: string[]): string[] {
  return resolved.filter((a) => !isLoopback(a) && !ownAddrs.includes(a));
}

export type GuestPathInput = {
  /** Addresses the guest service name resolved to (empty when none). */
  resolved: string[];
  /** Set when the DNS lookup itself failed — the expected, isolated case. */
  resolveError?: string;
  /** This container's own interface addresses. */
  ownAddrs: string[];
  /** The foreign address that was probed, when there was one. */
  probedAddr?: string;
  /** HTTP status when the probe got an answer — evidence of a real path. */
  httpStatus?: number;
  /** Connect/timeout error when the probe failed. */
  httpError?: string;
};

export type GuestPathVerdict = { ok: boolean; warn?: boolean; detail: string };

export function assessGuestPath(input: GuestPathInput): GuestPathVerdict {
  if (input.resolveError || input.resolved.length === 0) {
    return {
      ok: true,
      detail:
        "the guest service name does not resolve from this container (no shared Docker network, correct). The isolation is a missing shared network, so the guest container cannot reach this one either.",
    };
  }
  const foreign = foreignAddrs(input.resolved, input.ownAddrs);
  if (foreign.length === 0) {
    return {
      ok: true,
      detail: `the guest service name resolves only to ${input.resolved.join(", ")} — this container itself (a host self-alias forwarded by Docker's DNS), not a path to the guest container. No shared network.`,
    };
  }
  if (input.httpStatus !== undefined) {
    return {
      ok: false,
      detail: `an HTTP server answered at ${input.probedAddr}:3000 (HTTP ${input.httpStatus}) via the guest service name — the containers appear to share a Docker network; check the compose network assignments (docker network inspect).`,
    };
  }
  return {
    ok: true,
    warn: true,
    detail: `the guest service name resolves to ${input.probedAddr} upstream (likely a DNS search-domain artifact) but nothing answers there on :3000 — no container path detected. ${input.httpError ?? ""}`.trimEnd(),
  };
}
