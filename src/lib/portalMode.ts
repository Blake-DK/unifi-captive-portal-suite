/**
 * Guest/admin process split (Phase 17 A-lite). One image, one Postgres; two
 * containers can each run a role so a guest-side crash or leak can't touch the
 * admin process, and admin pages/APIs simply don't exist on the guest side.
 *
 * PORTAL_MODE:
 *   "guest" — serve only the guest/captive side; /admin + /api/admin 404, no
 *             background schedulers.
 *   "admin" — serve only the admin side; guest pages + guest APIs 404.
 *   unset / anything else — "all": one process serves everything (the default,
 *             today's single-container deployment, unchanged).
 *
 * The actual routing (which host reaches which container) is Traefik's job.
 * Backward compatible: with PORTAL_MODE unset, every check below is a no-op.
 */
export type PortalMode = "guest" | "admin" | "all";

export function portalMode(): PortalMode {
  const m = process.env.PORTAL_MODE?.toLowerCase();
  return m === "guest" || m === "admin" ? m : "all";
}

/**
 * True when the compose "split" profile is active — the ONLY signal that a
 * sibling portal-admin container actually exists (that service is
 * `profiles: ["split"]`). Read the same way seedBundledFromEnv reads the
 * "traefik" profile. PORTAL_MODE alone must NOT be treated as proof of a
 * sibling: a lone container with PORTAL_MODE set but no split profile would
 * otherwise point Traefik at a portal-admin host that doesn't resolve.
 */
export function splitProfileActive(): boolean {
  return composeProfileActive("split");
}

/**
 * True when the optional Traefik log dashboard stack (compose "logdash"
 * profile: log-tailing agent + web UI) is deployed. Gates the access-log
 * block in the bundled static config and the dashboard's router in the
 * dynamic config — with the profile off, neither exists and the output is
 * byte-identical to a pre-logdash deployment.
 */
export function logdashProfileActive(): boolean {
  return composeProfileActive("logdash");
}

function composeProfileActive(name: string): boolean {
  return (process.env.COMPOSE_PROFILES ?? "")
    .split(",")
    .map((p) => p.trim())
    .includes(name);
}

/** True when this process should run the background schedulers. */
export function schedulersEnabled(): boolean {
  return portalMode() !== "guest" && process.env.SCHEDULERS !== "off";
}

/**
 * True when this process owns the Traefik proxy control plane: it serves the
 * dynamic config (GET /api/traefik/config) and writes the bundled static
 * config. A guest-role process yields to its admin sibling ONLY when the split
 * is actually deployed (the "split" compose profile is active); a lone guest
 * process — PORTAL_MODE=guest set without the profile, a misconfiguration —
 * still owns it, so a half-configured single container can never brick its own
 * routing (instrumentation warns loudly about that state, see checkSplitConfig).
 */
export function ownsProxyControlPlane(): boolean {
  return portalMode() !== "guest" || !splitProfileActive();
}

/**
 * How Traefik reaches the admin container, or "" when this deployment routes
 * the admin host through the shared portal service (i.e. not a split, so the
 * output is byte-identical to the pre-split config).
 *
 * - "all" role (no PORTAL_MODE) always returns "": a single-container or
 *   backed-out deployment is never a split, so a stale ADMIN_UPSTREAM_URL left
 *   in .env after removing the split is ignored rather than routing the admin
 *   host at a decommissioned upstream.
 * - ADMIN_UPSTREAM_URL (external Traefik) otherwise wins, trailing slash
 *   trimmed so the provider endpoint never gets a "//".
 * - The automatic http://portal-admin:3000 requires the "split" profile (the
 *   only thing that starts that container) and a non-external proxy mode.
 */
export function adminUpstreamUrl(reverseProxyMode: string): string {
  if (portalMode() === "all") return "";
  const override = (process.env.ADMIN_UPSTREAM_URL ?? "").trim().replace(/\/+$/, "");
  if (override) return override;
  return splitProfileActive() && reverseProxyMode !== "external"
    ? "http://portal-admin:3000"
    : "";
}
