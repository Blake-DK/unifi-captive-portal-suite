import { mkdir, writeFile } from "fs/promises";
import { randomBytes } from "crypto";
import path from "path";
import { prisma } from "./prisma";
import { invalidateSettingsRow } from "./settingsRow";
import { adminUpstreamUrl, logdashProfileActive } from "./portalMode";
import { decryptSecret, encryptSecret } from "./secrets";

/**
 * Renders the bundled Traefik's *static* configuration into the shared
 * ./traefik mount (compose binds it rw here at /app/traefik and ro into the
 * traefik container at /etc/traefik). Everything changeable lives in the GUI
 * (Settings → URLs → Reverse Proxy); install.sh setup only seeds the first boot
 * (mode "bundled" + the admin URL, via .env — see seedBundledFromEnv):
 *   - traefik.yml   entrypoints, ACME (Cloudflare DNS-01), HTTP provider
 *   - cf-token      the Cloudflare zone token (0600); lego reads it via the
 *                   CF_DNS_API_TOKEN_FILE env the compose file points here
 *
 * Written on every Reverse-Proxy settings save and ensured on boot
 * (instrumentation), so a first `docker compose up` self-heals: traefik
 * restarts until the portal has written its config. Static changes
 * auto-apply — the traefik-ops sidecar restarts Traefik on file change.
 */

const OUT_DIR = process.env.TRAEFIK_OUT_DIR || "/app/traefik";
const POLL_INTERVAL = "5s";

export function buildStaticYaml(opts: {
  acmeEmail: string;
  configToken: string;
  /** Where the HTTP provider polls; blank/absent = the single-container default. */
  endpointBase?: string;
  /**
   * Emit a JSON access log for the optional log-dashboard stack (compose
   * "logdash" profile). Off = byte-identical pre-logdash output; the file
   * lands on the traefik-logs volume, which the traefik-ops sidecar
   * truncates when it outgrows its cap.
   */
  accessLog?: boolean;
}): string {
  const endpointBase = opts.endpointBase || "http://portal:3000";
  return `# Written by the portal (Settings -> URLs -> Reverse Proxy) — do not edit;
# saving those settings regenerates this file; the traefik-ops sidecar
# restarts Traefik automatically when it changes.
log:
  level: INFO
${
  opts.accessLog
    ? `accessLog:
  filePath: /var/log/traefik/access.log
  format: json
`
    : ""
}entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"
certificatesResolvers:
  cloudflare:
    acme:
      email: ${JSON.stringify(opts.acmeEmail || "unset@example.invalid")}
      storage: /acme/acme.json
      dnsChallenge:
        provider: cloudflare
        # Public resolvers for the propagation check: split-horizon LANs
        # (like this one) resolve the zone to an internal NS that never sees
        # the Cloudflare TXT record — lego must look at the internet's view.
        resolvers:
          - "1.1.1.1:53"
          - "8.8.8.8:53"
providers:
  http:
    endpoint: ${JSON.stringify(`${endpointBase}/api/traefik/config?token=${encodeURIComponent(opts.configToken)}`)}
    pollInterval: ${JSON.stringify(POLL_INTERVAL)}
`;
}

/**
 * First-boot seed: install.sh setup records the bundled-Traefik choice (and the
 * admin URL it asks for) in .env, but this module manages ./traefik only
 * when the DB says mode "bundled" — and on a fresh database nothing could
 * ever say so: Traefik had no config, the portal no published host port,
 * so the GUI that sets the mode was unreachable. Runs once — the config
 * token is minted by the first bundled write, so a present token means the
 * GUI owns these settings from then on (a later GUI switch to "none" or
 * "external" must survive reboots).
 */
async function seedBundledFromEnv(): Promise<void> {
  if (!(process.env.COMPOSE_PROFILES ?? "").split(",").includes("traefik")) return;
  const s = await prisma.systemSettings.findUnique({
    where: { id: "config" },
    select: { reverseProxyMode: true, adminBaseUrl: true, traefikConfigToken: true },
  });
  if (s?.traefikConfigToken || s?.reverseProxyMode === "external") return;
  const adminBaseUrl = (process.env.ADMIN_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const data = {
    reverseProxyMode: "bundled",
    ...(adminBaseUrl && !s?.adminBaseUrl ? { adminBaseUrl } : {}),
  };
  await prisma.systemSettings.upsert({
    where: { id: "config" },
    update: data,
    create: { id: "config", ...data },
  });
  invalidateSettingsRow();
}

/** The portal's config token, generating + persisting one on first use.
 * Self-healing: a stored token that no longer decrypts (ADMIN_SECRET changed,
 * DB restored onto a different stack) is REPLACED, not kept — the boot-time
 * ensureTraefikFiles then writes the fresh token into traefik.yml and the
 * traefik-ops sidecar restarts Traefik, so proxied domains come back without
 * operator surgery. */
export async function ensureConfigToken(): Promise<string> {
  const s = await prisma.systemSettings.findUnique({
    where: { id: "config" },
    select: { traefikConfigToken: true },
  });
  const existing = decryptSecret(s?.traefikConfigToken ?? "");
  if (existing) return existing;
  if (s?.traefikConfigToken) {
    console.warn(
      "[traefik] stored config token no longer decrypts (ADMIN_SECRET changed?) — regenerating; traefik.yml will be rewritten with the new token",
    );
  }
  const token = randomBytes(24).toString("hex");
  await prisma.systemSettings.upsert({
    where: { id: "config" },
    update: { traefikConfigToken: encryptSecret(token) },
    create: { id: "config", traefikConfigToken: encryptSecret(token) },
  });
  invalidateSettingsRow();
  return token;
}

/**
 * Write traefik.yml + cf-token for the bundled Traefik. No-op unless
 * reverseProxyMode is "bundled" (the ./traefik dir belongs to us only then).
 * Never throws — a missing mount (external installs) must not break boot.
 */
export async function ensureTraefikFiles(): Promise<void> {
  try {
    await seedBundledFromEnv();
    const s = await prisma.systemSettings.findUnique({
      where: { id: "config" },
      select: { reverseProxyMode: true, acmeEmail: true, cfDnsApiToken: true },
    });
    if (s?.reverseProxyMode !== "bundled") return;
    const token = await ensureConfigToken();
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(
      path.join(OUT_DIR, "traefik.yml"),
      // Split deployments point the provider at the admin container: the
      // routing config is control plane, and the guest process refuses to
      // serve it (see /api/traefik/config). Blank = single-container default.
      buildStaticYaml({
        acmeEmail: s.acmeEmail,
        configToken: token,
        endpointBase: adminUpstreamUrl("bundled"),
        accessLog: logdashProfileActive(),
      }),
      "utf8",
    );
    await writeFile(path.join(OUT_DIR, "cf-token"), decryptSecret(s.cfDnsApiToken) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (err) {
    console.error("[traefik] failed to write static config:", err);
  }
}
