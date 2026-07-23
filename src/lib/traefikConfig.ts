/**
 * Builds the Traefik *dynamic* configuration the portal serves at
 * GET /api/traefik/config (Traefik's HTTP provider polls it — same pattern
 * as Mantrae). Pure functions over settings + ProxyResource rows so the
 * whole thing is unit-testable; nothing here touches the DB.
 *
 * Shape notes:
 * - Every key is prefixed `portal-` so the output can merge into an
 *   operator's existing Traefik without collisions (external mode copy-out).
 * - A priority-1 catch-all router sends anything unmatched on :80 to the
 *   portal — that is what keeps the captive flow working when the Captive
 *   Portal URL is a bare IP (UniFi redirects guests to http://<ip>/...).
 *   For the same reason there is NO global 80→443 redirect: HTTPS hosts get
 *   their own per-host redirect routers instead.
 * - "Admin block" mirrors the old Pangolin DROP rules: a higher-priority
 *   router for /admin + /api/admin on guest-facing hosts runs a deny-all
 *   middleware (ipAllowList that matches nothing → 403).
 */

export type ProxyResourceInput = {
  name: string;
  hostname: string;
  targetUrl: string;
  tls: boolean;
  blockAdminPaths: boolean;
  enabled: boolean;
};

export type BuildInput = {
  portalBaseUrl: string;
  guestBaseUrl: string;
  adminBaseUrl: string;
  /** How Traefik reaches the portal: http://portal:3000 (bundled) or http://<portalTargetIp> (external). */
  portalServiceUrl: string;
  /**
   * Guest/admin split (Phase 17 A-lite): how Traefik reaches the admin
   * container. Blank/absent = no split — the admin host rides the shared
   * portal service, exactly the pre-split output.
   */
  adminServiceUrl?: string;
  resources: ProxyResourceInput[];
  /**
   * Optional Traefik log dashboard (compose "logdash" profile). The UI ships
   * with no login of its own, so every request is gated by a forwardAuth
   * middleware pointing back at the portal (admin-session sign-in — the
   * /api/logdash-auth pair owns the cross-host handoff). Both fields must be
   * non-blank for anything to be emitted.
   */
  logdash?: { host: string; serviceUrl: string };
};

type Router = {
  rule: string;
  service: string;
  entryPoints: string[];
  priority?: number;
  middlewares?: string[];
  tls?: { certResolver: string };
};
type Service = { loadBalancer: { servers: { url: string }[]; serversTransport?: string } };
type Middleware = Record<string, unknown>;

export type TraefikDynamicConfig = {
  http: {
    routers: Record<string, Router>;
    services: Record<string, Service>;
    middlewares: Record<string, Middleware>;
    serversTransports?: Record<string, Record<string, unknown>>;
  };
};

const CERT_RESOLVER = "cloudflare";
const ADMIN_BLOCK_RULE = "(PathPrefix(`/admin`) || PathPrefix(`/api/admin`))";

export function isIpHost(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** Hostname of a base URL; "" when blank/unparseable. */
export function urlHost(baseUrl: string): string {
  if (!baseUrl.trim()) return "";
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "";
  }
}

function urlIsHttps(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).protocol === "https:";
  } catch {
    return false;
  }
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "res";
}

/** One host's routers: main (+ https redirect and admin-block when asked). */
function hostRouters(
  cfg: TraefikDynamicConfig,
  key: string,
  host: string,
  service: string,
  opts: { https: boolean; blockAdmin: boolean },
) {
  const rule = `Host(\`${host}\`)`;
  if (opts.https) {
    cfg.http.routers[key] = {
      rule,
      service,
      entryPoints: ["websecure"],
      tls: { certResolver: CERT_RESOLVER },
    };
    // Plain-HTTP hits on an HTTPS host bounce to HTTPS (per-host, so the
    // bare-IP captive catch-all on :80 stays untouched).
    cfg.http.routers[`${key}-http`] = {
      rule,
      service,
      entryPoints: ["web"],
      middlewares: ["portal-redirect-https"],
    };
    cfg.http.middlewares["portal-redirect-https"] = {
      redirectScheme: { scheme: "https", permanent: true },
    };
  } else {
    cfg.http.routers[key] = { rule, service, entryPoints: ["web"] };
  }
  if (opts.blockAdmin) {
    cfg.http.routers[`${key}-admin-block`] = {
      rule: `${rule} && ${ADMIN_BLOCK_RULE}`,
      service,
      entryPoints: opts.https ? ["web", "websecure"] : ["web"],
      priority: 100,
      middlewares: ["portal-deny-all"],
      ...(opts.https ? { tls: { certResolver: CERT_RESOLVER } } : {}),
    };
    // ipAllowList that can never match → every request gets 403 before the
    // service is consulted. Traefik's native "deny" idiom.
    cfg.http.middlewares["portal-deny-all"] = {
      ipAllowList: { sourceRange: ["255.255.255.255/32"] },
    };
  }
}

export function buildDynamicConfig(input: BuildInput): TraefikDynamicConfig {
  const cfg: TraefikDynamicConfig = {
    http: { routers: {}, services: {}, middlewares: {} },
  };

  cfg.http.services["portal"] = {
    loadBalancer: { servers: [{ url: input.portalServiceUrl }] },
  };

  // Catch-all so unmatched Host headers (bare-IP captive hits, healthchecks
  // by IP) still reach the portal on :80.
  cfg.http.routers["portal-catchall"] = {
    rule: "PathPrefix(`/`)",
    service: "portal",
    entryPoints: ["web"],
    priority: 1,
  };

  // The portal's own three hosts. Captive host is guest-facing (block admin
  // paths); a bare-IP or blank captive URL rides the catch-all instead of
  // getting a router (mirrors the old Pangolin isIpHost skip).
  const portalHost = urlHost(input.portalBaseUrl);
  if (portalHost && !isIpHost(portalHost)) {
    hostRouters(cfg, "portal-captive", portalHost, "portal", {
      https: urlIsHttps(input.portalBaseUrl),
      blockAdmin: true,
    });
  }
  const guestHost = urlHost(input.guestBaseUrl);
  if (guestHost && !isIpHost(guestHost)) {
    hostRouters(cfg, "portal-guest", guestHost, "portal", {
      https: urlIsHttps(input.guestBaseUrl),
      blockAdmin: true,
    });
  }
  const adminHost = urlHost(input.adminBaseUrl);
  // Skip the admin router when the admin host is blank, a bare IP, or shares a
  // hostname with the guest OR captive host: emitting a second router with an
  // identical Host() rule would collide (equal priority, unspecified tie-break)
  // and, in a split, could send captive/guest traffic to the admin container.
  if (adminHost && !isIpHost(adminHost) && adminHost !== guestHost && adminHost !== portalHost) {
    // Split deployments route the admin host at the admin container; the
    // catch-all and guest hosts stay on the guest-serving portal service.
    const adminUpstream = input.adminServiceUrl?.trim() ?? "";
    if (adminUpstream) {
      cfg.http.services["portal-admin"] = {
        loadBalancer: { servers: [{ url: adminUpstream }] },
      };
    }
    hostRouters(cfg, "portal-admin", adminHost, adminUpstream ? "portal-admin" : "portal", {
      https: urlIsHttps(input.adminBaseUrl),
      blockAdmin: false,
    });
  }

  // Traefik log dashboard (optional logdash compose profile). HTTPS-only,
  // and every request forwardAuths back to the portal, which demands the
  // admin session (the dashboard itself has no login). The auth endpoint
  // lives on whichever process owns the admin side — the same upstream the
  // admin host routes to. Skipped when the host is blank, a bare IP, or
  // colliding with one of the portal's hosts.
  const ld = input.logdash;
  const ldHost = ld?.host.trim().toLowerCase() ?? "";
  if (
    ld &&
    ldHost &&
    !isIpHost(ldHost) &&
    ld.serviceUrl.trim() &&
    ![portalHost, guestHost, adminHost].includes(ldHost)
  ) {
    const authBase = input.adminServiceUrl?.trim() || input.portalServiceUrl;
    cfg.http.services["portal-logdash"] = {
      loadBalancer: { servers: [{ url: ld.serviceUrl.trim() }] },
    };
    cfg.http.middlewares["portal-logdash-auth"] = {
      forwardAuth: { address: `${authBase.replace(/\/+$/, "")}/api/logdash-auth` },
    };
    const ldRule = `Host(\`${ldHost}\`)`;
    cfg.http.routers["portal-logdash"] = {
      rule: ldRule,
      service: "portal-logdash",
      entryPoints: ["websecure"],
      tls: { certResolver: CERT_RESOLVER },
      middlewares: ["portal-logdash-auth"],
    };
    cfg.http.routers["portal-logdash-http"] = {
      rule: ldRule,
      service: "portal-logdash",
      entryPoints: ["web"],
      middlewares: ["portal-redirect-https"],
    };
    cfg.http.middlewares["portal-redirect-https"] = {
      redirectScheme: { scheme: "https", permanent: true },
    };
  }

  // Extra resources (other LAN services behind the same Traefik).
  for (const r of input.resources) {
    if (!r.enabled || !r.hostname.trim() || !r.targetUrl.trim()) continue;
    const key = `portal-res-${slug(r.name)}`;
    cfg.http.services[key] = { loadBalancer: { servers: [{ url: r.targetUrl }] } };
    // https:// upstreams are LAN services with self-signed certs — Traefik
    // verifies upstream certificates by default, which 500s every request.
    // Skip verification for them (same default as Nginx Proxy Manager);
    // http:// and h2c:// upstreams have no TLS to verify.
    if (r.targetUrl.startsWith("https:")) {
      cfg.http.services[key].loadBalancer.serversTransport = "portal-insecure-upstream";
      cfg.http.serversTransports = {
        ...cfg.http.serversTransports,
        "portal-insecure-upstream": { insecureSkipVerify: true },
      };
    }
    hostRouters(cfg, key, r.hostname.trim(), key, {
      https: r.tls,
      blockAdmin: r.blockAdminPaths,
    });
  }

  return cfg;
}

/**
 * Minimal YAML emitter for the copy-out card (file-provider users). Only
 * handles what our config shapes contain: plain objects, arrays, strings,
 * numbers, booleans. Backtick-heavy Traefik rules are double-quoted.
 */
export function toYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]\n`;
    return value
      .map((v) =>
        typeof v === "object" && v !== null
          ? `${pad}-\n${toYaml(v, indent + 1)}`
          : `${pad}- ${scalar(v)}\n`,
      )
      .join("");
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${pad}{}\n`;
    return entries
      .map(([k, v]) =>
        typeof v === "object" && v !== null
          ? `${pad}${k}:\n${toYaml(v, indent + 1)}`
          : `${pad}${k}: ${scalar(v)}\n`,
      )
      .join("");
  }
  return `${pad}${scalar(value)}\n`;
}

function scalar(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}
