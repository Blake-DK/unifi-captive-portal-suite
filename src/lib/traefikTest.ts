import { connect as tlsConnect } from "tls";
import { Agent, request } from "undici";
import { prisma } from "./prisma";
import { urlHost, isIpHost } from "./traefikConfig";
import { traefikLastPolledAt } from "./traefikPollStatus";

/**
 * Live "is the reverse proxy actually working?" checks for the Test button
 * on Settings → URLs → Reverse Proxy. Probes go THROUGH Traefik (service
 * name `traefik` on the compose bridge in bundled mode; the real hostnames
 * via DNS in external mode), so a green run means: the entrypoints answer,
 * the dynamic config loaded, per-host routing works, admin paths are
 * blocked on guest hosts, and certificates are real Let's Encrypt issues.
 */

export type ProxyCheck = {
  name: string;
  ok: boolean;
  warn?: boolean;
  detail: string;
};

const PROBE_TIMEOUT_MS = 5000;

function describeStatus(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return `route loaded, but the backend answered ${status} — check the target service`;
  }
  return `HTTP ${status}`;
}

async function probe(
  scheme: "http" | "https",
  target: string,
  host: string,
  path: string,
): Promise<{ status: number } | { error: string }> {
  const agent = new Agent({
    connect: { servername: host, rejectUnauthorized: false },
  });
  try {
    const res = await request(`${scheme}://${target}${path}`, {
      dispatcher: agent,
      headers: { host },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    await res.body.dump();
    return { status: res.statusCode };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "request failed" };
  } finally {
    void agent.close();
  }
}

function certInfo(
  target: string,
  servername: string,
): Promise<{ issuer: string; daysLeft: number } | { error: string }> {
  return new Promise((resolve) => {
    const sock = tlsConnect(
      { host: target, port: 443, servername, rejectUnauthorized: false, timeout: PROBE_TIMEOUT_MS },
      () => {
        const cert = sock.getPeerCertificate();
        sock.end();
        const issuer = String(cert?.issuer?.O ?? cert?.issuer?.CN ?? "unknown");
        const daysLeft = cert?.valid_to
          ? Math.round((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000)
          : -1;
        resolve({ issuer, daysLeft });
      },
    );
    sock.on("error", (e) => resolve({ error: e.message }));
    sock.setTimeout(PROBE_TIMEOUT_MS, () => {
      sock.destroy();
      resolve({ error: "timeout" });
    });
  });
}

function routeOk(status: number): boolean {
  // Anything the app/backend answered (2xx/3xx/4xx-auth) means the router
  // matched and forwarded; 404 from Traefik itself means no router.
  return status > 0 && status !== 404 && status < 500;
}

export async function runProxyChecks(): Promise<{ checks: ProxyCheck[]; mode: string }> {
  const s = await prisma.systemSettings.findUnique({
    where: { id: "config" },
    select: {
      reverseProxyMode: true,
      portalBaseUrl: true,
      guestBaseUrl: true,
      adminBaseUrl: true,
    },
  });
  const mode = s?.reverseProxyMode ?? "none";
  const checks: ProxyCheck[] = [];
  if (mode === "none") {
    return { checks: [{ name: "Reverse proxy", ok: true, warn: true, detail: "Mode is 'none' — nothing to test." }], mode };
  }

  // Bundled: Traefik is a compose sibling; External: trust DNS for each host.
  const fixedTarget = mode === "bundled" ? "traefik" : null;
  const target = (host: string) => fixedTarget ?? host;

  const polled = traefikLastPolledAt();
  const polledAge = polled ? Date.now() - new Date(polled).getTime() : null;
  checks.push({
    name: "Traefik polls the config endpoint",
    ok: polledAge !== null && polledAge < 30_000,
    detail:
      polledAge === null
        ? "never polled this portal instance — is the container running and the token current?"
        : `last poll ${Math.round(polledAge / 1000)}s ago`,
  });

  // HTTP entrypoint + catch-all: any unmatched Host on :80 must reach the
  // portal (this is what keeps the bare-IP captive flow alive).
  const catchall = await probe("http", fixedTarget ?? (urlHost(s?.portalBaseUrl ?? "") || "portal:3000"), "proxy-test.invalid", "/api/health");
  checks.push({
    name: "HTTP catch-all → portal (captive fallback)",
    ok: "status" in catchall && catchall.status === 200,
    detail: "status" in catchall ? describeStatus(catchall.status) : catchall.error,
  });

  const hosts: { label: string; host: string; https: boolean; guestFacing: boolean }[] = [];
  const captiveHost = urlHost(s?.portalBaseUrl ?? "");
  if (captiveHost && !isIpHost(captiveHost)) {
    hosts.push({ label: "Captive host", host: captiveHost, https: (s?.portalBaseUrl ?? "").startsWith("https"), guestFacing: true });
  }
  const guestHost = urlHost(s?.guestBaseUrl ?? "");
  if (guestHost && !isIpHost(guestHost)) {
    hosts.push({ label: "Guest host", host: guestHost, https: (s?.guestBaseUrl ?? "").startsWith("https"), guestFacing: true });
  }
  const adminHost = urlHost(s?.adminBaseUrl ?? "");
  if (adminHost && !isIpHost(adminHost) && adminHost !== guestHost) {
    hosts.push({ label: "Admin host", host: adminHost, https: (s?.adminBaseUrl ?? "").startsWith("https"), guestFacing: false });
  }

  for (const h of hosts) {
    const scheme = h.https ? "https" : "http";
    const r = await probe(scheme, target(h.host), h.host, "/");
    checks.push({
      name: `${h.label} route (${scheme}://${h.host})`,
      ok: "status" in r && routeOk(r.status),
      detail: "status" in r ? describeStatus(r.status) : r.error,
    });

    if (h.https) {
      const c = await certInfo(target(h.host), h.host);
      if ("error" in c) {
        checks.push({ name: `${h.label} certificate`, ok: false, detail: c.error });
      } else {
        const real = /let's encrypt/i.test(c.issuer);
        checks.push({
          name: `${h.label} certificate`,
          ok: real,
          warn: !real,
          detail: real
            ? `Let's Encrypt, ${c.daysLeft} days left (auto-renews)`
            : `issuer "${c.issuer}" — not issued yet (check the Cloudflare token / ACME logs)`,
        });
      }
    }

    if (h.guestFacing) {
      const b = await probe(scheme, target(h.host), h.host, "/admin/login");
      checks.push({
        name: `${h.label} blocks /admin at the proxy`,
        ok: "status" in b && b.status === 403,
        detail: "status" in b ? `HTTP ${b.status}${b.status === 403 ? " (blocked, correct)" : " — expected 403"}` : b.error,
      });
    } else {
      const a = await probe(scheme, target(h.host), h.host, "/admin/login");
      checks.push({
        name: `${h.label} serves /admin`,
        ok: "status" in a && routeOk(a.status),
        detail: "status" in a ? describeStatus(a.status) : a.error,
      });
    }
  }

  const resources = await prisma.proxyResource.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" } });
  for (const r of resources) {
    const scheme = r.tls ? "https" : "http";
    const p = await probe(scheme, target(r.hostname), r.hostname, "/");
    checks.push({
      name: `Resource "${r.name}" (${scheme}://${r.hostname})`,
      ok: "status" in p && routeOk(p.status),
      warn: "status" in p && p.status >= 502 && p.status <= 504,
      detail: "status" in p ? describeStatus(p.status) : p.error,
    });
  }

  return { checks, mode };
}
