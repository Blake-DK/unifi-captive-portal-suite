import { NextRequest, NextResponse } from "next/server";
import { Agent, fetch as undiciFetch } from "undici";
import { getPortalConfig, type PortalConfig } from "@/lib/config";
import {
  checkUnifiLockout,
  clearUnifiLoginFailures,
  noteUnifiLoginFailure,
  probeIntegrationApi,
  unifiLoginBackoff,
} from "@/lib/unifi";
import { requireAdmin } from "@/lib/adminGuard";

export const runtime = "nodejs";

type Attempt = { url: string; status: number; body: string };

async function tryLogin(
  url: string,
  username: string,
  password: string,
  insecure: boolean,
): Promise<{ ok: boolean; status: number; body: string; csrfToken?: string; cookie?: string }> {
  const agent = new Agent({ connect: { rejectUnauthorized: !insecure } });
  try {
    const res = await undiciFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, remember: true }),
      dispatcher: agent,
    });
    const body = await res.text().catch(() => "");
    const csrfToken =
      res.headers.get("x-csrf-token") ?? res.headers.get("x-updated-csrf-token") ?? undefined;
    const cookie = res.headers.get("set-cookie") ?? undefined;
    return { ok: res.ok, status: res.status, body: body.slice(0, 500), csrfToken, cookie };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const cfg = await getPortalConfig();

  // Both credential types get exercised and reported side by side: the
  // username/password login (the portal's main session mechanism) and the
  // Integration API key, so the operator sees which one is broken.
  const apiKey = cfg.unifiApiKey
    ? await probeIntegrationApi()
        .then((p) => ({
          configured: true,
          ok: p.ok,
          status: p.status,
          error: p.error ?? null,
          siteCount: p.sites?.length ?? null,
        }))
        .catch((e) => ({
          configured: true,
          ok: false,
          status: 0,
          error: e instanceof Error ? e.message : String(e),
          siteCount: null,
        }))
    : { configured: false };
  const login = await testLogin(cfg);
  const backupAccounts = await testBackupAccounts(cfg, login);
  return NextResponse.json({ ...login, apiKey, backupAccounts });
}

type BackupResult = {
  username: string;
  ok: boolean;
  status?: number;
  error?: string;
  skipped?: boolean;
};

/**
 * One login test per configured backup account. When the endpoint is known
 * (explicit API type, or the primary test just succeeded somewhere) each
 * backup gets exactly one attempt there. Under auto-detect with a failing or
 * suspended primary — the very moment backups matter — each backup runs the
 * same two-step dance the runtime failover uses: classic first, and only the
 * Network-App error shape triggers the second endpoint. The expected
 * wrong-endpoint 401 is lockout-checked but never counted (same rule as the
 * primary's probe), so testing cannot cool a healthy backup down.
 */
async function testBackupAccounts(
  cfg: PortalConfig,
  login: { success: boolean; attempts: { url: string; status: number }[] },
): Promise<BackupResult[]> {
  const backups = (cfg.unifiAccounts ?? []).slice(1);
  if (backups.length === 0) return [];

  const base = cfg.unifiUrl.replace(/\/$/, "");
  const apiType = cfg.unifiApiType || "auto";
  const successUrl = login.attempts.find((a) => a.status >= 200 && a.status < 300)?.url;
  const endpoint =
    successUrl ??
    (apiType === "classic"
      ? `${base}/api/login`
      : apiType === "network_app"
        ? `${base}/api/auth/login`
        : null);

  const out: BackupResult[] = [];
  for (const acct of backups) {
    const b = unifiLoginBackoff(cfg, acct);
    if (b) {
      out.push({
        username: acct.username,
        ok: false,
        skipped: true,
        error: `Suspended for ~${Math.max(1, Math.ceil((b.until - Date.now()) / 60000))} more min: ${b.reason}`,
      });
      continue;
    }

    let r = await tryLogin(endpoint ?? `${base}/api/login`, acct.username, acct.password, cfg.unifiInsecureTls);
    if (!r.ok && !endpoint) {
      // Auto-detect: the classic probe failing is only meaningful if it's a
      // lockout; the Network-App error shape sends us to the real endpoint.
      if (checkUnifiLockout(cfg, r.status, r.body, acct)) {
        out.push({
          username: acct.username,
          ok: false,
          status: r.status,
          error: "The controller reports this account locked/rate-limited — it now rests for 30 minutes.",
        });
        continue;
      }
      if (r.body.includes('"code"')) {
        r = await tryLogin(`${base}/api/auth/login`, acct.username, acct.password, cfg.unifiInsecureTls);
      }
    }
    if (r.ok) {
      clearUnifiLoginFailures(cfg, acct);
      out.push({ username: acct.username, ok: true, status: r.status });
    } else {
      noteUnifiLoginFailure(cfg, r.status, r.body, acct);
      out.push({ username: acct.username, ok: false, status: r.status, error: r.body.slice(0, 200) });
    }
  }
  return out;
}

async function testLogin(cfg: PortalConfig) {
  // Always include `attempts` — the settings page maps over it unconditionally,
  // so an early return without it used to crash the page (TypeError on .map).
  if (!cfg.unifiUrl) {
    return ({
      success: false,
      attempts: [],
      recommendation: "Enter the controller URL, save the settings, then test again.",
      error: "Controller URL is not configured",
    });
  }
  if (!cfg.unifiUsername || !cfg.unifiPassword) {
    return ({
      success: false,
      attempts: [],
      recommendation: "Enter the username and password, save the settings, then test again — the test uses the saved values.",
      error: "Username or password is not configured",
    });
  }

  // A locked-out account must not be poked — every attempt extends the lock.
  const backoff = unifiLoginBackoff(cfg);
  if (backoff) {
    return ({
      success: false,
      attempts: [],
      recommendation:
        "Wait for the lockout to clear, then test again. Saving changed credentials retries immediately.",
      error: `Login test skipped: ${backoff.reason}. ~${Math.max(1, Math.ceil((backoff.until - Date.now()) / 60000))} min remaining.`,
    });
  }

  const base = cfg.unifiUrl.replace(/\/$/, "");
  const apiType = cfg.unifiApiType || "auto";
  const attempts: Attempt[] = [];

  if (apiType === "classic") {
    const url = `${base}/api/login`;
    const r = await tryLogin(url, cfg.unifiUsername, cfg.unifiPassword, cfg.unifiInsecureTls);
    attempts.push({ url, status: r.status, body: r.body });
    if (r.ok) {
      clearUnifiLoginFailures(cfg);
      return ({ success: true, attempts, recommendation: "classic" });
    }
    noteUnifiLoginFailure(cfg, r.status, r.body);
    return ({
      success: false,
      attempts,
      recommendation: r.body.includes('"code"')
        ? 'This looks like a Network Application controller. Try changing the API Type to "Network Application".'
        : "Check your username, password, and controller URL.",
    });
  }

  if (apiType === "network_app") {
    const url = `${base}/api/auth/login`;
    const r = await tryLogin(url, cfg.unifiUsername, cfg.unifiPassword, cfg.unifiInsecureTls);
    attempts.push({ url, status: r.status, body: r.body });
    if (r.ok) {
      clearUnifiLoginFailures(cfg);
      return ({ success: true, attempts, recommendation: "network_app" });
    }
    noteUnifiLoginFailure(cfg, r.status, r.body);
    return ({
      success: false,
      attempts,
      recommendation: r.body.includes("api not found") || r.status === 404
        ? 'This looks like a Classic Controller. Try changing the API Type to "Classic Controller".'
        : "Check your username, password, and controller URL.",
    });
  }

  // auto: try classic first, then network_app
  const classicUrl = `${base}/api/login`;
  const classicResult = await tryLogin(classicUrl, cfg.unifiUsername, cfg.unifiPassword, cfg.unifiInsecureTls);
  attempts.push({ url: classicUrl, status: classicResult.status, body: classicResult.body });

  if (classicResult.ok) {
    clearUnifiLoginFailures(cfg);
    return ({ success: true, attempts, recommendation: "classic" });
  }
  // The classic probe is EXPECTED to fail on a Network App controller, so it
  // must not count toward the cooldown (three green tests used to suspend a
  // healthy account) — but an actual lockout still stops the second endpoint.
  if (checkUnifiLockout(cfg, classicResult.status, classicResult.body)) {
    return ({
      success: false,
      attempts,
      recommendation:
        "The account looks locked out — the portal will stop trying to log in for 30 minutes so the lock can clear.",
    });
  }

  const networkUrl = `${base}/api/auth/login`;
  const networkResult = await tryLogin(networkUrl, cfg.unifiUsername, cfg.unifiPassword, cfg.unifiInsecureTls);
  attempts.push({ url: networkUrl, status: networkResult.status, body: networkResult.body });

  if (networkResult.ok) {
    clearUnifiLoginFailures(cfg);
    return ({
      success: true,
      // Only the attempt that worked: auto-detect probing classic first and
      // getting a 401 is expected on a Network Application controller, and
      // listing that probe made a green result look like an error.
      attempts: attempts.filter((a) => a.url === networkUrl),
      recommendation: 'network_app — set API Type to "Network Application" to skip the classic probe.',
    });
  }

  noteUnifiLoginFailure(cfg, networkResult.status, networkResult.body);
  return ({
    success: false,
    attempts,
    recommendation: "Both endpoints failed. Check your controller URL, credentials, and whether the controller is reachable.",
  });
}
