/**
 * Guest/admin split (Phase 17 A-lite) config sanity checks. Enabling the split
 * takes two coordinated .env edits (PORTAL_MODE + COMPOSE_PROFILES) plus a
 * routable admin hostname, and none of the half-configured states fail loudly
 * on their own — several silently brick routing or lock the admin GUI out. This
 * pure function names each one so instrumentation can warn at boot; it never
 * throws and returns [] for a healthy config (split or single-container).
 *
 * Hostnames are pre-extracted by the caller (urlHost/isIpHost live in
 * traefikConfig) so this module stays dependency-free.
 */
export type SplitConfigInput = {
  /** portalMode() */
  mode: "guest" | "admin" | "all";
  /** splitProfileActive() — COMPOSE_PROFILES contains "split" */
  splitProfileActive: boolean;
  /** SystemSettings.reverseProxyMode */
  reverseProxyMode: string;
  /** adminUpstreamUrl(reverseProxyMode) — resolved value, "" when not a split */
  adminUpstreamUrl: string;
  /** urlHost() of each URL — "" when blank/unparseable */
  portalHost: string;
  guestHost: string;
  adminHost: string;
  /** isIpHost(adminHost) — a bare-IP admin URL gets no Traefik router */
  adminHostIsIp: boolean;
};

export function checkSplitConfig(i: SplitConfigInput): string[] {
  const warns: string[] = [];
  const roleSplit = i.mode !== "all";

  // Profile on, but this process runs "all": PORTAL_MODE was left unset. The
  // base container then serves BOTH sides (no isolation) and fights the admin
  // container over the shared traefik.yml.
  if (i.splitProfileActive && i.mode === "all") {
    warns.push(
      'COMPOSE_PROFILES includes "split" but PORTAL_MODE is unset here — this ' +
        "container serves both the guest and admin sides and will fight the " +
        "portal-admin container over the Traefik config. Set PORTAL_MODE=guest.",
    );
  }

  // Role set, but no split profile (bundled): the portal-admin container is not
  // running, so nothing serves what this half expects of its sibling.
  if (roleSplit && !i.splitProfileActive && i.reverseProxyMode !== "external") {
    warns.push(
      `PORTAL_MODE=${i.mode} is set but the "split" compose profile is not ` +
        'active, so the portal-admin container is not running. Add "split" to ' +
        "COMPOSE_PROFILES, or unset PORTAL_MODE to run a single container.",
    );
  }

  // External split needs the upstream override; without it the admin host is
  // routed at the guest container (adminUpstreamUrl returns "").
  if (roleSplit && i.reverseProxyMode === "external" && !i.adminUpstreamUrl) {
    warns.push(
      "A split behind an external Traefik needs ADMIN_UPSTREAM_URL set to the " +
        "admin container's URL; without it the admin host is routed at the " +
        "guest container and the admin GUI 404s.",
    );
  }

  // A split is actually routing (adminUpstreamUrl resolved) but the admin URL
  // can't get its own Traefik router → admin GUI unreachable on every host.
  if (i.adminUpstreamUrl) {
    if (!i.adminHost || i.adminHostIsIp) {
      warns.push(
        "A split needs a hostname Admin GUI URL (Settings → URLs); a blank or " +
          "bare-IP admin URL gets no Traefik router, so the admin GUI is " +
          "unreachable on every hostname.",
      );
    } else if (i.adminHost === i.guestHost || i.adminHost === i.portalHost) {
      warns.push(
        "The Admin GUI URL shares its hostname with the guest/captive URL; " +
          "under a split no separate admin route can exist and the admin GUI " +
          "becomes unreachable. Give the admin side its own hostname.",
      );
    }
  }

  return warns;
}
