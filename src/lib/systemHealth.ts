import { readFile } from "fs/promises";
import { lookup } from "dns/promises";
import { networkInterfaces } from "os";
import path from "path";
import { Agent, request } from "undici";
import { assessGuestPath, foreignAddrs } from "./guestPathCheck";
import { prisma } from "./prisma";
import { getBuildInfo } from "./version";
import { logdashProfileActive, portalMode, splitProfileActive, type PortalMode } from "./portalMode";
import { parseDockerStatus, type ContainerStatus } from "./dockerStatus";
import { urlHost } from "./traefikConfig";
import { traefikLastPolledAt, traefikLastDeniedAt } from "./traefikPollStatus";
import type { ProxyCheck } from "./traefikTest";

/**
 * The System Health panel at the bottom of Settings → URLs: one place that
 * answers "is the stack up and is the guest/admin separation actually
 * holding?". Two data sources:
 *
 *  - docker-status.json, published into the shared ./traefik mount by the
 *    traefik-ops sidecar (the only socket holder) — real container state.
 *  - Live probes from THIS process: DB, Traefik config polling, and — under
 *    a split — the separation itself: this process must be the admin role,
 *    a direct connection to the guest container must FAIL (no shared
 *    network; the isolation is symmetric, so a pass here also means the
 *    guest cannot reach the admin container), the guest side must answer
 *    through the proxy (the only legitimate path) on the same build, and
 *    the admin surface must be absent on the guest host.
 */

export type SystemHealthReport = {
  /** No hard failures (warnings allowed). */
  ok: boolean;
  generatedAt: string;
  split: { mode: PortalMode; active: boolean };
  reverseProxyMode: string;
  docker:
    | { available: false; reason: string }
    | { available: true; stale: boolean; generatedAt: string | null; containers: ContainerStatus[] };
  checks: ProxyCheck[];
};

const PROBE_TIMEOUT_MS = 5000;
// Same default as traefikStatic.ts OUT_DIR — the shared ./traefik mount.
const STATUS_DIR = process.env.TRAEFIK_OUT_DIR || "/app/traefik";

/** Probe with an explicit Host header (through Traefik in bundled mode). */
async function probeBody(
  scheme: "http" | "https",
  target: string,
  host: string,
  urlPath: string,
): Promise<{ status: number; body: string } | { error: string }> {
  const agent = new Agent({ connect: { servername: host, rejectUnauthorized: false } });
  try {
    const res = await request(`${scheme}://${target}${urlPath}`, {
      dispatcher: agent,
      headers: { host },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = await res.body.text();
    return { status: res.statusCode, body };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "request failed" };
  } finally {
    void agent.close();
  }
}

/**
 * Separation probe: from the admin container, `portal` (the guest service)
 * should not resolve — the two sit on disjoint Docker networks. Resolve
 * first and discard loopback/own-interface answers (Docker's DNS forwards
 * unknown names to the host, whose /etc/hosts self-alias — a host machine
 * literally named "portal" — makes a bare HTTP probe hit THIS container and
 * false-alarm; seen live on the first split host). Only an HTTP answer from
 * a genuinely foreign address fails the check; guestPathCheck.ts holds the
 * verdict logic.
 */
async function guestNetworkPathCheck(): Promise<ProxyCheck> {
  const name = "Separation: no network path to the guest container";
  const ownAddrs = Object.values(networkInterfaces())
    .flat()
    .flatMap((i) => (i ? [i.address] : []));
  let resolved: string[] = [];
  try {
    resolved = (await lookup("portal", { all: true })).map((a) => a.address);
  } catch (e) {
    const v = assessGuestPath({
      resolved: [],
      resolveError: e instanceof Error ? e.message : "lookup failed",
      ownAddrs,
    });
    return { name, ...v };
  }
  const foreign = foreignAddrs(resolved, ownAddrs);
  if (foreign.length === 0) return { name, ...assessGuestPath({ resolved, ownAddrs }) };
  const addr = foreign[0];
  const url = `http://${addr.includes(":") ? `[${addr}]` : addr}:3000/api/health`;
  try {
    const res = await request(url, { signal: AbortSignal.timeout(3000) });
    await res.body.dump();
    return {
      name,
      ...assessGuestPath({ resolved, ownAddrs, probedAddr: addr, httpStatus: res.statusCode }),
    };
  } catch (e) {
    return {
      name,
      ...assessGuestPath({
        resolved,
        ownAddrs,
        probedAddr: addr,
        httpError: e instanceof Error ? e.message : "unreachable",
      }),
    };
  }
}

export async function runSystemHealth(): Promise<SystemHealthReport> {
  const checks: ProxyCheck[] = [];
  const mode = portalMode();
  const split = splitProfileActive();
  const build = getBuildInfo();

  // The settings read doubles as the DB liveness check.
  let s: {
    reverseProxyMode: string;
    portalBaseUrl: string;
    guestBaseUrl: string;
  } | null = null;
  const t0 = Date.now();
  try {
    s = await prisma.systemSettings.findUnique({
      where: { id: "config" },
      select: { reverseProxyMode: true, portalBaseUrl: true, guestBaseUrl: true },
    });
    checks.push({ name: "Database", ok: true, detail: `PostgreSQL answered in ${Date.now() - t0} ms` });
  } catch (e) {
    checks.push({
      name: "Database",
      ok: false,
      detail: `query failed — ${e instanceof Error ? e.message : "unknown error"}`,
    });
  }
  const rpMode = s?.reverseProxyMode ?? "none";

  let docker: SystemHealthReport["docker"];
  try {
    const raw = await readFile(path.join(STATUS_DIR, "docker-status.json"), "utf8");
    docker = { available: true, ...parseDockerStatus(raw, Date.now()) };
  } catch {
    docker = {
      available: false,
      reason:
        rpMode === "bundled"
          ? "no docker-status.json in the shared ./traefik mount — the traefik-ops sidecar publishes it; if the sidecar predates this feature, one `docker compose restart traefik-ops` picks up the new script"
          : 'published by the traefik-ops sidecar, which only runs with the bundled proxy ("traefik" compose profile)',
    };
  }

  if (docker.available) {
    const bad = docker.containers.filter((c) => !c.ok);
    const starting = docker.containers.filter((c) => c.warn);
    checks.push({
      name: "Docker containers",
      ok: bad.length === 0,
      warn: bad.length === 0 && (starting.length > 0 || docker.stale),
      detail: docker.stale
        ? `status file is stale (last written ${docker.generatedAt ?? "unknown"}) — is the traefik-ops sidecar still running?`
        : bad.length
          ? `${bad.map((c) => c.name).join(", ")} not running or unhealthy`
          : starting.length
            ? `${docker.containers.length} present; ${starting.map((c) => c.name).join(", ")} still starting`
            : `all ${docker.containers.length} running and healthy`,
    });
    if (rpMode === "bundled" && !docker.containers.some((c) => c.name.endsWith("-traefik"))) {
      checks.push({
        name: "Traefik container present",
        ok: false,
        detail: 'reverse-proxy mode is bundled but no traefik container exists — is COMPOSE_PROFILES missing "traefik"?',
      });
    }
  } else if (rpMode === "bundled") {
    // Bundled mode is supposed to have the sidecar — surface the gap as a
    // warning rather than a hard failure (the stack may still be fine).
    checks.push({ name: "Docker containers", ok: false, warn: true, detail: docker.reason });
  }

  if (rpMode === "bundled") {
    const polled = traefikLastPolledAt();
    const denied = traefikLastDeniedAt();
    const ageMs = polled ? Date.now() - new Date(polled).getTime() : null;
    const deniedNewer =
      !!denied && (!polled || new Date(denied).getTime() > new Date(polled).getTime());
    checks.push({
      name: "Traefik config polling",
      ok: ageMs !== null && ageMs < 30_000 && !deniedNewer,
      detail: deniedNewer
        ? "Traefik polls with a rejected token (stale traefik.yml) — Save Settings on this page regenerates it"
        : ageMs === null
          ? "never polled this portal instance since it started"
          : `last poll ${Math.round(ageMs / 1000)} s ago`,
    });
  }

  // Log dashboard (optional logdash compose profile): checks only exist
  // while the profile is on — absence is the default, not a finding.
  if (logdashProfileActive()) {
    const ldHost = (process.env.LOGDASH_HOST ?? "").trim();

    checks.push(
      !ldHost
        ? {
            name: "Log dashboard: configuration",
            ok: false,
            detail: "the logdash profile is active but LOGDASH_HOST is blank — the router is never emitted (fail closed); run scripts/enable-logdash.sh",
          }
        : {
            name: "Log dashboard: configuration",
            ok: true,
            detail: `host ${ldHost}; sign-in rides the portal admin session`,
          },
    );

    if (docker.available) {
      // endsWith keeps -logdash and -logdash-agent distinct.
      const missing = ["-logdash-agent", "-logdash"].filter(
        (suffix) => !docker.containers.some((c) => c.name.endsWith(suffix)),
      );
      checks.push({
        name: "Log dashboard: containers present",
        ok: missing.length === 0,
        detail:
          missing.length === 0
            ? "agent and dashboard containers exist (state in the container grid above)"
            : `no ${missing.map((m) => m.slice(1)).join(" or ")} container — run docker compose up -d after enabling the profile`,
      });
    }

    if (rpMode === "bundled") {
      let yml = "";
      try {
        yml = await readFile(path.join(STATUS_DIR, "traefik.yml"), "utf8");
      } catch {
        /* missing file reads as no accessLog below */
      }
      const logOn = yml.includes("accessLog:");
      checks.push({
        name: "Log dashboard: Traefik access log",
        ok: logOn,
        detail: logOn
          ? "the bundled static config writes the JSON access log the agent tails"
          : "traefik.yml has no accessLog block — this process wrote it before the profile was enabled; docker compose up -d (recreating the portal) rewrites it",
      });
    }

    if (ldHost && (rpMode === "bundled" || rpMode === "external")) {
      // A session-less probe must bounce to the admin-host sign-in (302) —
      // that one status proves the router, the forwardAuth middleware, and
      // the auth endpoint in a single round trip. 401 = auth endpoint alive
      // but no Admin URL configured to send the browser to.
      const target = rpMode === "bundled" ? "traefik" : ldHost;
      const r = await probeBody("https", target, ldHost, "/");
      const status = "error" in r ? null : r.status;
      checks.push({
        name: "Log dashboard: sign-in gate",
        ok: status === 302,
        warn: status === 401,
        detail:
          "error" in r
            ? `probe via the proxy failed — ${r.error}`
            : status === 302
              ? `${ldHost} redirects signed-out visitors to the admin sign-in (correct)`
              : status === 401
                ? "the auth gate is up but has no Admin URL to send sign-ins to — set it in Settings → URLs"
                : status === 404
                  ? `no router for ${ldHost} yet — Traefik may not have polled the new config; check again shortly`
                  : status === 200
                    ? `${ldHost} answered WITHOUT a session — the auth gate is not enforced, investigate before exposing this host`
                    : `HTTP ${status} from ${ldHost} — expected a 302 to the admin sign-in`,
      });
    }
  }

  if (split) {
    checks.push({
      name: "Separation: dedicated admin process",
      ok: mode === "admin",
      detail:
        mode === "admin"
          ? "this page is served by the admin-only container (PORTAL_MODE=admin); guest pages don't exist in this process"
          : `the split profile is active but this process runs in "${mode}" mode — check PORTAL_MODE in .env`,
    });

    checks.push(await guestNetworkPathCheck());

    // Guest-side liveness through the proxy — the only legitimate path.
    const captiveHost = urlHost(s?.portalBaseUrl ?? "");
    const guestHost = urlHost(s?.guestBaseUrl ?? "");
    const host = captiveHost || guestHost;
    if ((rpMode === "bundled" || rpMode === "external") && host) {
      const scheme: "http" | "https" =
        host === captiveHost
          ? (s?.portalBaseUrl ?? "").startsWith("https")
            ? "https"
            : "http"
          : "https";
      const target = rpMode === "bundled" ? "traefik" : host;

      const h = await probeBody(scheme, target, host, "/api/health");
      if ("error" in h || h.status !== 200) {
        checks.push({
          name: "Guest container serves guests",
          ok: false,
          detail:
            "error" in h
              ? `probe via the proxy failed — ${h.error}`
              : `HTTP ${h.status} from ${host}/api/health via the proxy — expected 200`,
        });
      } else {
        let commit = "";
        try {
          commit = String((JSON.parse(h.body) as { commit?: unknown })?.commit ?? "");
        } catch {
          /* non-JSON body handled below as unknown build */
        }
        const sameBuild = !!commit && commit === build.sha;
        checks.push({
          name: "Guest container serves guests",
          ok: true,
          warn: !sameBuild,
          detail: sameBuild
            ? `answers through the proxy and runs the same build as this admin container (${build.shortSha})`
            : `answers through the proxy but reports build ${commit ? commit.slice(0, 7) : "unknown"} vs this container's ${build.shortSha} — mid-update, or one side needs a restart`,
        });
      }

      const b = await probeBody(scheme, target, host, "/admin/login");
      const blocked = !("error" in b) && (b.status === 403 || b.status === 404);
      checks.push({
        name: "Separation: admin surface absent on the guest host",
        ok: blocked,
        detail:
          "error" in b
            ? `probe failed — ${b.error}`
            : blocked
              ? `HTTP ${b.status} for ${host}/admin/login (blocked, correct)`
              : `HTTP ${b.status} for ${host}/admin/login — expected 403 (proxy block) or 404 (guest-mode process)`,
      });
    }
  } else {
    checks.push({
      name: "Guest/admin split",
      ok: true,
      detail:
        'not enabled — one container serves both sides. The separation checks appear here once the "split" compose profile is active.',
    });
  }

  const containersOk = !docker.available || docker.containers.every((c) => c.ok);
  return {
    ok: containersOk && checks.every((c) => c.ok || c.warn),
    generatedAt: new Date().toISOString(),
    split: { mode, active: split },
    reverseProxyMode: rpMode,
    docker,
    checks,
  };
}
