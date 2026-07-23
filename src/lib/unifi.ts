import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";
import { getPortalConfig, type PortalConfig, type UniFiAccount } from "./config";
import { physicalMacForm } from "./mac";
import { Semaphore } from "./semaphore";

type UniFiSession = {
  cookieHeader: string;
  csrfToken?: string;
  expiresAt: number;
  // UniFi OS "Network Application" controllers proxy the classic site-manager
  // API (/api/s/{site}/...) under /proxy/network; standalone controllers don't.
  usesProxy: boolean;
};

const SESSION_TTL_MS = 55 * 60 * 1000;

// Login-lockout circuit breaker: after repeated failed logins the controller
// locks the local account for ~30 minutes, and every further attempt EXTENDS
// the lock — so hammering it (each admin page load retries the cookie login)
// keeps the account locked forever. Once a login response looks like a
// lockout/rate-limit, suspend that account's login attempts for 30 minutes so
// the lock can expire. State is PER ACCOUNT (keyed to url+credentials, so
// saving changed settings retries immediately; in-memory, so a container
// restart also clears it): with backup accounts configured, login() fails
// over to the next slot while an earlier one is suspended — accounts are
// never round-robined while healthy, so a wrong password only ever burns its
// own account's attempts, not the whole set.
const LOGIN_BACKOFF_MS = 30 * 60 * 1000;
// Pre-emptive cooldown: a stale/wrong password returns a plain 401 with no
// "locked" wording, so the lockout breaker above never trips — and every
// admin page load would retry the login until the controller DOES lock the
// account. So after a few consecutive failures of ANY kind we cool down
// too, short of the 30-min lockout window, to stay UNDER the controller's
// lockout threshold instead of driving into it.
const MAX_CONSECUTIVE_FAILURES = 3;
const AUTH_COOLDOWN_MS = 10 * 60 * 1000;

type AccountState = { failures: number; until: number; reason: string };
const accountStates = new Map<string, AccountState>();

/** Connection-level failure (DNS/refused/TLS) — credential-independent, so
 * account failover must not retry it once per account. Exported so the alert
 * monitor's controller-outage watchdog can name the failure mode. */
export class UniFiUnreachableError extends Error {}

/** Login accounts in failover order; hand-built configs without the list
 * fall back to the primary username/password fields. */
function accountsOf(cfg: PortalConfig): UniFiAccount[] {
  if (cfg.unifiAccounts?.length) return cfg.unifiAccounts;
  return cfg.unifiUsername && cfg.unifiPassword
    ? [{ username: cfg.unifiUsername, password: cfg.unifiPassword }]
    : [];
}

function stateOf(cfg: PortalConfig, acct: UniFiAccount): AccountState {
  const key = accountKey(cfg, acct);
  let s = accountStates.get(key);
  if (!s) {
    s = { failures: 0, until: 0, reason: "" };
    accountStates.set(key, s);
  }
  return s;
}

function accountKey(cfg: PortalConfig, acct: UniFiAccount): string {
  return [cfg.unifiUrl, acct.username, acct.password].join("\u0000");
}

/** The active login backoff for one account (default: the primary), or null. */
export function unifiLoginBackoff(
  cfg: PortalConfig,
  account?: UniFiAccount,
): { until: number; reason: string } | null {
  const acct = account ?? accountsOf(cfg)[0];
  if (!acct) return null;
  const s = accountStates.get(accountKey(cfg, acct));
  return s && s.until > Date.now() ? { until: s.until, reason: s.reason } : null;
}

function looksLikeLockout(status: number, body: string): boolean {
  if (status === 429) return true;
  const t = body.toLowerCase();
  return (
    t.includes("lock") ||
    t.includes("too many") ||
    t.includes("limit_reached") ||
    t.includes("attempts_exceeded")
  );
}

function engageLockout(cfg: PortalConfig, acct: UniFiAccount, status: number): void {
  const s = stateOf(cfg, acct);
  s.until = Date.now() + LOGIN_BACKOFF_MS;
  s.reason = `the controller reported the account "${acct.username}" locked / rate-limited (HTTP ${status}) and every retry extends the lock`;
  console.error(
    `UniFi login backoff for "${acct.username}" engaged until ${new Date(s.until).toISOString()} (HTTP ${status})`,
  );
}

/**
 * Lockout check only, WITHOUT counting — for the intermediate auto-detect
 * probe (classic endpoint), which is expected to fail on a UniFi OS
 * controller and must not count toward the consecutive-failure cooldown.
 * Engages the 30-min backoff if the response is an actual lockout.
 */
function checkLockout(
  cfg: PortalConfig,
  acct: UniFiAccount,
  status: number,
  body: string,
): { until: number; reason: string } | null {
  if (looksLikeLockout(status, body)) engageLockout(cfg, acct, status);
  return unifiLoginBackoff(cfg, acct);
}

/**
 * Record a TERMINAL failed login (the whole login failed, not just an
 * expected probe) for one account (default: the primary). An explicit
 * lockout/rate-limit engages the full 30-minute backoff immediately;
 * otherwise the failure is counted and, once MAX_CONSECUTIVE_FAILURES is
 * reached, a shorter cooldown engages so we stop poking a bad credential
 * before the controller locks it. Returns the backoff now in effect.
 */
export function noteUnifiLoginFailure(
  cfg: PortalConfig,
  status: number,
  body: string,
  account?: UniFiAccount,
): { until: number; reason: string } | null {
  const acct = account ?? accountsOf(cfg)[0];
  if (!acct) return null;
  if (looksLikeLockout(status, body)) {
    engageLockout(cfg, acct, status);
    return unifiLoginBackoff(cfg, acct);
  }
  const s = stateOf(cfg, acct);
  s.failures++;
  if (s.failures >= MAX_CONSECUTIVE_FAILURES) {
    s.until = Date.now() + AUTH_COOLDOWN_MS;
    s.reason = `${s.failures} consecutive failed logins for "${acct.username}" (HTTP ${status}) — likely a wrong/stale password; pausing to avoid locking the account`;
    console.error(
      `UniFi login cooldown for "${acct.username}" engaged until ${new Date(s.until).toISOString()} after ${s.failures} failures`,
    );
  }
  return unifiLoginBackoff(cfg, acct);
}

/** Reset the account's failure counter and any backoff after a successful login. */
function noteUnifiLoginSuccess(cfg: PortalConfig, acct: UniFiAccount): void {
  accountStates.delete(accountKey(cfg, acct));
}

/**
 * Count-free lockout check for operator-triggered probes (default: the
 * primary account) — the Test Connection button's auto-detect pokes an
 * endpoint that is EXPECTED to 401 on the other controller type, and counting
 * that toward the cooldown would suspend a perfectly healthy account after a
 * few green tests.
 */
export function checkUnifiLockout(
  cfg: PortalConfig,
  status: number,
  body: string,
  account?: UniFiAccount,
): { until: number; reason: string } | null {
  const acct = account ?? accountsOf(cfg)[0];
  if (!acct) return null;
  return checkLockout(cfg, acct, status, body);
}

/** Clear an account's breaker state after an operator-verified login success. */
export function clearUnifiLoginFailures(cfg: PortalConfig, account?: UniFiAccount): void {
  const acct = account ?? accountsOf(cfg)[0];
  if (acct) accountStates.delete(accountKey(cfg, acct));
}

function backoffError(b: { until: number; reason: string }): Error {
  const mins = Math.max(1, Math.ceil((b.until - Date.now()) / 60000));
  return new Error(
    `UniFi login suspended for ~${mins} more min: ${b.reason}. ` +
      `It clears automatically; saving changed credentials clears it immediately.`,
  );
}

let cachedSession: UniFiSession | null = null;
let cachedDispatcher: { insecure: boolean; agent: Agent } | null = null;

function getDispatcher(insecure: boolean): Agent {
  if (!cachedDispatcher || cachedDispatcher.insecure !== insecure) {
    cachedDispatcher = {
      insecure,
      agent: new Agent({
        connect: { rejectUnauthorized: !insecure },
        // Bound what a burst can open against the controller (it runs on
        // the gateway), and fail hung requests instead of parking them for
        // undici's 5-minute default.
        connections: 16,
        headersTimeout: 30_000,
        bodyTimeout: 60_000,
      }),
    };
  }
  return cachedDispatcher.agent;
}

function parseSetCookie(header: string | null): string {
  if (!header) return "";
  return header
    .split(/,(?=[^;]+=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function loginEndpoint(base: string, apiType: string): string {
  if (apiType === "network_app") return `${base}/api/auth/login`;
  return `${base}/api/login`; // "classic" or first attempt of "auto"
}

async function attemptLogin(
  base: string,
  endpoint: string,
  cfg: PortalConfig,
  acct: UniFiAccount,
): Promise<{ res: UndiciResponse; text: string }> {
  let res: UndiciResponse;
  try {
    res = await undiciFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: acct.username, password: acct.password, remember: true }),
      dispatcher: getDispatcher(cfg.unifiInsecureTls),
    });
  } catch (err) {
    throw new UniFiUnreachableError(
      `UniFi controller unreachable at ${base}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const text = await res.text().catch(() => "");
  return { res, text };
}

/** One full login attempt (endpoint auto-detect and all) with ONE account.
 * Terminal failures are recorded against that account and thrown. */
async function loginWithAccount(cfg: PortalConfig, acct: UniFiAccount): Promise<UniFiSession> {
  const base = cfg.unifiUrl.replace(/\/$/, "");
  const apiType = cfg.unifiApiType || "auto";

  let res: UndiciResponse;
  let text: string;
  let usesProxy: boolean;

  if (apiType === "auto") {
    // Try classic endpoint first; if it responds with the Network App error shape, retry network_app
    const classic = await attemptLogin(base, `${base}/api/login`, cfg, acct);
    if (!classic.res.ok) {
      // The classic probe is EXPECTED to fail on a UniFi OS controller — only
      // an actual lockout here matters; don't count it toward the cooldown.
      const lockedOut = checkLockout(cfg, acct, classic.res.status, classic.text);
      if (lockedOut) throw backoffError(lockedOut);
      // Network Application returns {"error":{"code":N,"message":"..."}} — detect by presence of "code"
      const looksLikeNetworkApp = classic.text.includes('"code"');
      if (looksLikeNetworkApp) {
        const networkApp = await attemptLogin(base, `${base}/api/auth/login`, cfg, acct);
        if (!networkApp.res.ok) {
          const b = noteUnifiLoginFailure(cfg, networkApp.res.status, networkApp.text, acct);
          if (b) throw backoffError(b);
          throw new Error(
            `UniFi login failed on both endpoints.\n` +
            `  /api/login (${classic.res.status}): ${classic.text.slice(0, 300)}\n` +
            `  /api/auth/login (${networkApp.res.status}): ${networkApp.text.slice(0, 300)}`,
          );
        }
        res = networkApp.res;
        text = networkApp.text;
        usesProxy = true;
      } else {
        // Genuine classic-controller login failure — terminal, so count it.
        const b = noteUnifiLoginFailure(cfg, classic.res.status, classic.text, acct);
        if (b) throw backoffError(b);
        throw new Error(`UniFi login failed (${classic.res.status}): ${classic.text.slice(0, 500)}`);
      }
    } else {
      res = classic.res;
      text = classic.text;
      usesProxy = false;
    }
  } else {
    const endpoint = loginEndpoint(base, apiType);
    const attempt = await attemptLogin(base, endpoint, cfg, acct);
    if (!attempt.res.ok) {
      const b = noteUnifiLoginFailure(cfg, attempt.res.status, attempt.text, acct);
      if (b) throw backoffError(b);
      throw new Error(`UniFi login failed (${attempt.res.status}): ${attempt.text.slice(0, 500)}`);
    }
    res = attempt.res;
    text = attempt.text;
    usesProxy = apiType === "network_app";
  }

  noteUnifiLoginSuccess(cfg, acct);

  void text; // consumed for error messages; cookie comes from headers
  const cookieHeader = parseSetCookie(res.headers.get("set-cookie"));
  const csrfToken =
    res.headers.get("x-csrf-token") ??
    res.headers.get("x-updated-csrf-token") ??
    undefined;

  cachedSession = { cookieHeader, csrfToken, expiresAt: Date.now() + SESSION_TTL_MS, usesProxy };
  return cachedSession;
}

/**
 * Login with lockout failover: accounts are tried in slot order, skipping any
 * whose backoff is active, so backups only ever carry traffic while an
 * earlier account is locked out / cooling down or its login just failed —
 * healthy accounts are never round-robined. Connection-level errors abort the
 * whole loop (credential-independent). When every account is suspended, the
 * thrown backoff reports the one that clears soonest.
 */
async function login(cfg: PortalConfig): Promise<UniFiSession> {
  if (!cfg.unifiUrl) throw new Error("UniFi URL is not configured");
  const accounts = accountsOf(cfg);
  if (accounts.length === 0) throw new Error("UniFi username / password not configured");

  let lastError: Error | null = null;
  for (const acct of accounts) {
    if (unifiLoginBackoff(cfg, acct)) continue;
    try {
      const session = await loginWithAccount(cfg, acct);
      if (acct !== accounts[0]) {
        console.warn(
          `UniFi login succeeded with backup account "${acct.username}" (earlier account(s) suspended or failing)`,
        );
      }
      return session;
    } catch (e) {
      if (e instanceof UniFiUnreachableError) throw e;
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  const backoffs = accounts.map((a) => unifiLoginBackoff(cfg, a));
  if (backoffs.every((b) => b !== null)) {
    const soonest = backoffs.reduce((m, b) => (b!.until < m!.until ? b : m))!;
    throw backoffError({
      until: soonest.until,
      reason:
        accounts.length > 1
          ? `all ${accounts.length} UniFi accounts are suspended; soonest to clear — ${soonest.reason}`
          : soonest.reason,
    });
  }
  throw lastError ?? new Error("UniFi login failed for every configured account");
}

// Single-flight login: under load dozens of requests can hit an expired or
// missing session at once, and each used to fire its own login; the
// controller rate-limits those, which engages the lockout breaker above and
// takes guest auth down for half an hour. All concurrent callers share one
// login attempt instead.
let loginInFlight: Promise<UniFiSession> | null = null;

function loginOnce(cfg: PortalConfig): Promise<UniFiSession> {
  if (!loginInFlight) {
    loginInFlight = login(cfg).finally(() => {
      loginInFlight = null;
    });
  }
  return loginInFlight;
}

// Refresh the session in the background this long before it expires, so a
// busy period never lands exactly on the expiry edge with no valid cookie.
const SESSION_REFRESH_AHEAD_MS = 5 * 60 * 1000;

async function ensureSession(): Promise<{ session: UniFiSession; cfg: PortalConfig }> {
  const cfg = await getPortalConfig();
  const current = cachedSession;
  if (current && current.expiresAt > Date.now()) {
    if (current.expiresAt - Date.now() < SESSION_REFRESH_AHEAD_MS) {
      // Proactive and non-blocking; if it fails, the first caller past the
      // expiry does a blocking login exactly as before.
      loginOnce(cfg).catch(() => {});
    }
    return { session: current, cfg };
  }
  const session = await loginOnce(cfg);
  return { session, cfg };
}

async function unifiRequest<T = unknown>(
  path: string,
  init: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const doFetch = async (session: UniFiSession, cfg: PortalConfig) => {
    const base = cfg.unifiUrl.replace(/\/$/, "");
    const fullPath = session.usesProxy ? `/proxy/network${path}` : path;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      cookie: session.cookieHeader,
    };
    if (session.csrfToken) headers["x-csrf-token"] = session.csrfToken;
    return undiciFetch(`${base}${fullPath}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      dispatcher: getDispatcher(cfg.unifiInsecureTls),
    });
  };

  let { session, cfg } = await ensureSession();
  let res = await doFetch(session, cfg);

  if (res.status === 401 || res.status === 403) {
    cachedSession = null;
    const fresh = await loginOnce(cfg);
    res = await doFetch(fresh, cfg);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`UniFi ${path} failed (${res.status}): ${text}`);
  }

  const newCsrf = res.headers.get("x-updated-csrf-token");
  if (newCsrf && cachedSession) cachedSession.csrfToken = newCsrf;

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- Integration API (X-API-KEY, UniFi OS 4+ / Network 9+) -----------------
// The Integration API (/proxy/network/integration/v1) covers only a READ
// subset — sites, clients, devices — so an API key supplements the local
// account instead of replacing it: guest authorization, client notes, user
// groups, sessions, events and every write stay on the cookie session. The
// key's value is resilience: the basic monitoring reads below fall back to it
// when the cookie login is unavailable (locked account, changed password), so
// the admin pages degrade instead of going dark.

type IntegrationPage<T> = { offset?: number; limit?: number; totalCount?: number; data?: T[] };

export type IntegrationSite = { id: string; internalReference?: string; name?: string };

let cachedIntegrationSiteId: string | null = null;

async function integrationRequest<T = unknown>(path: string): Promise<T> {
  const cfg = await getPortalConfig();
  if (!cfg.unifiApiKey) throw new Error("UniFi API key is not configured");
  if (!cfg.unifiUrl) throw new Error("UniFi URL is not configured");
  const base = cfg.unifiUrl.replace(/\/$/, "");
  const res = await undiciFetch(`${base}/proxy/network/integration/v1${path}`, {
    headers: { "x-api-key": cfg.unifiApiKey, accept: "application/json" },
    dispatcher: getDispatcher(cfg.unifiInsecureTls),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`UniFi integration ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Page through an Integration-API list endpoint (`{offset,limit,totalCount,data}`). */
async function integrationList<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  // Bounded so a misreporting controller can't loop us forever.
  for (let page = 0; page < 50; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await integrationRequest<IntegrationPage<T>>(`${path}${sep}offset=${offset}&limit=200`);
    const rows = res.data ?? [];
    out.push(...rows);
    const total = res.totalCount ?? rows.length;
    offset += rows.length;
    if (rows.length === 0 || offset >= total) break;
  }
  return out;
}

export async function listIntegrationSites(): Promise<IntegrationSite[]> {
  return integrationList<IntegrationSite>("/sites");
}

/** Resolve the classic site name (cfg.unifiSite) to the Integration API's site id. */
async function integrationSiteId(): Promise<string> {
  if (cachedIntegrationSiteId) return cachedIntegrationSiteId;
  const cfg = await getPortalConfig();
  const sites = await listIntegrationSites();
  const match =
    sites.find((s) => s.internalReference === cfg.unifiSite) ??
    sites.find((s) => s.name === cfg.unifiSite) ??
    sites[0];
  if (!match) throw new Error("Integration API returned no sites for this key");
  cachedIntegrationSiteId = match.id;
  return match.id;
}

type IntegrationClient = {
  id?: string;
  name?: string;
  ipAddress?: string;
  macAddress?: string;
  type?: string; // "WIRED" | "WIRELESS" | ...
};

type IntegrationDevice = {
  id?: string;
  name?: string;
  model?: string;
  macAddress?: string;
  ipAddress?: string;
  state?: string; // "ONLINE" | "OFFLINE" | ...
  firmwareVersion?: string;
  firmwareUpdatable?: boolean;
};

/**
 * Connected clients via the Integration API, mapped onto the classic
 * UniFiStation shape. Only the basic fields exist here (no _id, VLAN, AP,
 * usergroup, RSSI…) — callers that need those must use the cookie session.
 */
async function listStationsViaIntegration(): Promise<UniFiStation[]> {
  const siteId = await integrationSiteId();
  const rows = await integrationList<IntegrationClient>(`/sites/${siteId}/clients`);
  return rows
    .filter((c) => c.macAddress)
    .map((c) => ({
      mac: (c.macAddress as string).toLowerCase(),
      name: c.name,
      ip: c.ipAddress,
      is_wired: c.type === "WIRED",
    }));
}

/** Adopted devices via the Integration API, mapped onto UniFiDeviceHealth (basic fields only). */
async function listDevicesViaIntegration(): Promise<UniFiDeviceHealth[]> {
  const siteId = await integrationSiteId();
  const rows = await integrationList<IntegrationDevice>(`/sites/${siteId}/devices`);
  return rows
    .filter((d) => d.macAddress)
    .map((d) => ({
      mac: (d.macAddress as string).toLowerCase(),
      name: d.name,
      model: d.model,
      ip: d.ipAddress,
      state: d.state === "ONLINE" ? 1 : 0,
      version: d.firmwareVersion,
      upgradable: d.firmwareUpdatable,
    }));
}

/** Capability probe for the "Test API key" button — GET /integration/v1/sites. */
export async function probeIntegrationApi(): Promise<{
  ok: boolean;
  status: number;
  error?: string;
  sites?: IntegrationSite[];
}> {
  const cfg = await getPortalConfig();
  if (!cfg.unifiApiKey) return { ok: false, status: 0, error: "No API key configured" };
  if (!cfg.unifiUrl) return { ok: false, status: 0, error: "Controller URL is not configured" };
  const base = cfg.unifiUrl.replace(/\/$/, "");
  try {
    const res = await undiciFetch(`${base}/proxy/network/integration/v1/sites`, {
      headers: { "x-api-key": cfg.unifiApiKey, accept: "application/json" },
      dispatcher: getDispatcher(cfg.unifiInsecureTls),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        error:
          res.status === 401
            ? "The controller rejected the API key (401)."
            : res.status === 404
              ? "No Integration API on this controller (404) — requires UniFi OS 4+ / Network 9+."
              : text.slice(0, 300),
      };
    }
    const body = (await res.json()) as IntegrationPage<IntegrationSite>;
    return { ok: true, status: res.status, sites: body.data ?? [] };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export type AuthorizeGuestOptions = {
  mac: string;
  /** 0 (or less) = unlimited — sent to UniFi as a 10-year window. */
  minutes: number;
  upKbps?: number;
  downKbps?: number;
  bytesQuotaMB?: number;
  apMac?: string | null;
  /** Optional note to write onto the client on the controller (best-effort). */
  note?: string;
};

/** "First Last 12345" — guest name + last 5 phone digits, for the UniFi note. */
export function guestClientNote(firstName: string, lastName: string, phone: string): string {
  const name = `${firstName ?? ""} ${lastName ?? ""}`.replace(/\s+/g, " ").trim();
  const last5 = (phone ?? "").replace(/\D/g, "").slice(-5);
  return [name, last5].filter(Boolean).join(" ");
}

// --- Deferred client notes --------------------------------------------
// Stamping the guest's identity onto the controller client used to happen
// inline during registration, but resolving a MAC to its user id means
// fetching the FULL station list, megabytes on a busy site, per guest.
// Notes are cosmetic, so they queue here and a periodic sweep applies all
// of them against ONE station-list fetch. Entries whose client never shows
// up on the controller (guest left before associating) age out.
const pendingNotes = new Map<string, { note: string; queuedAt: number }>();
const NOTE_SWEEP_INTERVAL_MS = 30_000;
const NOTE_MAX_AGE_MS = 15 * 60 * 1000;
let noteSweepTimer: ReturnType<typeof setTimeout> | null = null;

export function queueClientNote(mac: string, note: string): void {
  pendingNotes.set(mac.toLowerCase(), { note, queuedAt: Date.now() });
  scheduleNoteSweep();
}

function scheduleNoteSweep(): void {
  if (noteSweepTimer) return;
  noteSweepTimer = setTimeout(async () => {
    try {
      await sweepClientNotes();
    } catch (err) {
      console.error("client-note sweep failed:", err instanceof Error ? err.message : err);
    } finally {
      noteSweepTimer = null;
      if (pendingNotes.size > 0) scheduleNoteSweep();
    }
  }, NOTE_SWEEP_INTERVAL_MS);
  noteSweepTimer.unref?.();
}

async function sweepClientNotes(): Promise<void> {
  if (pendingNotes.size === 0) return;
  const { cfg } = await ensureSession();
  // The Integration-API fallback inside listStations carries no _id, so a
  // cookie-session outage simply resolves nothing this pass and the entries
  // wait for the next one (or age out).
  const stations = await listStations();
  const idByMac = new Map<string, string>();
  for (const s of stations) if (s._id) idByMac.set(s.mac.toLowerCase(), s._id);
  for (const [mac, entry] of pendingNotes) {
    const userId = idByMac.get(mac);
    if (userId) {
      pendingNotes.delete(mac);
      try {
        await unifiRequest(`/api/s/${cfg.unifiSite}/rest/user/${userId}`, {
          method: "PUT",
          body: { note: entry.note, noted: true },
        });
      } catch (err) {
        console.error(
          `client-note sweep: could not set note on ${mac}:`,
          err instanceof Error ? err.message : err,
        );
      }
    } else if (Date.now() - entry.queuedAt > NOTE_MAX_AGE_MS) {
      pendingNotes.delete(mac);
    }
  }
}

// UniFi's authorize-guest has no "never expire" value, so "unlimited" is a
// window longer than any deployment will live.
const UNLIMITED_MINUTES = 10 * 525_600;

// A registration burst must not turn into a pile of parallel controller
// calls: the semaphore keeps a bounded number in flight and queues the rest,
// so guests see added latency instead of timeouts (and the controller never
// sees the stampede).
const authorizeSemaphore = new Semaphore(6);

export async function authorizeGuest(opts: AuthorizeGuestOptions): Promise<void> {
  const { cfg } = await ensureSession();
  const payload: Record<string, unknown> = {
    cmd: "authorize-guest",
    mac: opts.mac.toLowerCase(),
    minutes: opts.minutes > 0 ? opts.minutes : UNLIMITED_MINUTES,
  };
  if (opts.upKbps) payload.up = opts.upKbps;
  if (opts.downKbps) payload.down = opts.downKbps;
  if (opts.bytesQuotaMB) payload.bytes = opts.bytesQuotaMB;
  if (opts.apMac) payload.ap_mac = opts.apMac.toLowerCase();

  await authorizeSemaphore.run(() =>
    unifiRequest(`/api/s/${cfg.unifiSite}/cmd/stamgr`, { method: "POST", body: payload }),
  );

  // The guest-identity note is applied by the background sweep above,
  // best-effort, never on the registration path.
  if (opts.note) queueClientNote(opts.mac, opts.note);
}

export async function unauthorizeGuest(mac: string): Promise<void> {
  const { cfg } = await ensureSession();
  await unifiRequest(`/api/s/${cfg.unifiSite}/cmd/stamgr`, {
    method: "POST",
    body: { cmd: "unauthorize-guest", mac: mac.toLowerCase() },
  });
}

/**
 * The controller refuses block-sta/unblock-sta on anything its OUI check
 * reads as UniFi hardware (api.err.BlockUnifiDeviceForbidden) — adopted or
 * not. That check is not always right: it clears the locally-administered
 * bit before matching, so a RANDOMISED client MAC can be mistaken for
 * Ubiquiti gear (seen live: a TP-Link RE315 extender on a private MAC).
 * Say both possibilities rather than asserting the wrong one.
 */
function rethrowBlockForbidden(err: unknown, mac: string): never {
  if (err instanceof Error && err.message.includes("api.err.BlockUnifiDeviceForbidden")) {
    const randomised = isLocallyAdministeredMac(mac);
    throw new Error(
      randomised
        ? `${mac} cannot be blocked: it is a randomised (private) MAC, and the controller's OUI check ` +
          `misreads it as UniFi hardware. Check the client's hostname — if it is not UniFi gear, block it ` +
          `by its real MAC (disable private-address/randomisation on the device), or shut its switch port.`
        : `${mac} is UniFi hardware (AP, switch or gateway) — the controller refuses to block its own kind, ` +
          `even when the device is not adopted here. Handle it on the Rogue UniFi devices tab: adopt it, ` +
          `reset it over SSH, or ignore it if it belongs to someone else.`,
    );
  }
  throw err;
}

/** Locally-administered bit = randomised/private MAC. */
function isLocallyAdministeredMac(mac: string): boolean {
  const first = parseInt(mac.trim().slice(0, 2), 16);
  return Number.isFinite(first) && (first & 0x02) !== 0;
}

/** Fully disconnect a client from every SSID/port and refuse reconnection until unblocked. */
export async function blockStation(mac: string): Promise<void> {
  const { cfg } = await ensureSession();
  await unifiRequest(`/api/s/${cfg.unifiSite}/cmd/stamgr`, {
    method: "POST",
    body: { cmd: "block-sta", mac: mac.toLowerCase() },
  }).catch((err) => rethrowBlockForbidden(err, mac));
}

export async function unblockStation(mac: string): Promise<void> {
  const { cfg } = await ensureSession();
  await unifiRequest(`/api/s/${cfg.unifiSite}/cmd/stamgr`, {
    method: "POST",
    body: { cmd: "unblock-sta", mac: mac.toLowerCase() },
  }).catch((err) => rethrowBlockForbidden(err, mac));
}

// --- Per-client bandwidth throttle (UniFi user groups) ---------------------
// UniFi rate-limits a client by putting it in a "user group" that carries a
// max down/up (Kbps). We keep one reusable group per rate ("Portal-Throttle-
// <down>-<up>"), create it on demand, and move the client in/out of it.

export type UniFiUserGroup = {
  _id: string;
  name: string;
  qos_rate_max_down?: number; // Kbps, -1 = unlimited
  qos_rate_max_up?: number;
};

export async function listUserGroups(): Promise<UniFiUserGroup[]> {
  const { cfg } = await ensureSession();
  const res = await unifiRequest<{ data: UniFiUserGroup[] }>(`/api/s/${cfg.unifiSite}/rest/usergroup`);
  return res.data ?? [];
}

/** The site "Default" user group id (unlimited) — where un-throttle returns a client. */
async function defaultUserGroupId(groups: UniFiUserGroup[]): Promise<string | null> {
  const byName = groups.find((g) => g.name === "Default");
  if (byName) return byName._id;
  const unlimited = groups.find(
    (g) => (g.qos_rate_max_down ?? -1) === -1 && (g.qos_rate_max_up ?? -1) === -1,
  );
  return unlimited?._id ?? groups[0]?._id ?? null;
}

/** Find-or-create the reusable throttle group for a given down/up rate (Kbps). */
async function ensureThrottleGroup(downKbps: number, upKbps: number): Promise<string> {
  const { cfg } = await ensureSession();
  const name = `Portal-Throttle-${downKbps}-${upKbps}`;
  const existing = (await listUserGroups()).find((g) => g.name === name);
  if (existing) return existing._id;
  const res = await unifiRequest<{ data: UniFiUserGroup[] }>(
    `/api/s/${cfg.unifiSite}/rest/usergroup`,
    { method: "POST", body: { name, qos_rate_max_down: downKbps, qos_rate_max_up: upKbps } },
  );
  const id = res.data?.[0]?._id;
  if (!id) throw new Error("Could not create the throttle user group on the controller");
  return id;
}

/** Resolve a MAC to its user-record id (needed to change its user group). */
async function userIdForMac(mac: string): Promise<string> {
  const sta = (await listStations()).find((s) => s.mac.toLowerCase() === mac.toLowerCase());
  if (!sta?._id) throw new Error("Client is not currently connected (can't resolve it on the controller)");
  return sta._id;
}

async function setUserGroup(userId: string, groupId: string): Promise<void> {
  const { cfg } = await ensureSession();
  await unifiRequest(`/api/s/${cfg.unifiSite}/rest/user/${userId}`, {
    method: "PUT",
    body: { usergroup_id: groupId },
  });
}

/** Put a connected client into a throttle group at the given down/up (Kbps). */
export async function throttleClient(mac: string, downKbps: number, upKbps: number): Promise<void> {
  const userId = await userIdForMac(mac);
  const groupId = await ensureThrottleGroup(downKbps, upKbps);
  await setUserGroup(userId, groupId);
}

/** Return a client to the Default (unlimited) user group. */
export async function unthrottleClient(mac: string): Promise<void> {
  const userId = await userIdForMac(mac);
  const def = await defaultUserGroupId(await listUserGroups());
  if (!def) throw new Error("No Default user group found on the controller");
  await setUserGroup(userId, def);
}

export type UniFiGuest = {
  mac: string;
  ap_mac?: string;
  essid?: string;
  ip?: string;
  hostname?: string;
  start?: number;
  end?: number;
  duration?: number;
  tx_bytes?: number;
  rx_bytes?: number;
  authorized?: boolean;
};

export async function listActiveGuests(): Promise<UniFiGuest[]> {
  const { cfg } = await ensureSession();
  const res = await unifiRequest<{ data: UniFiGuest[] }>(`/api/s/${cfg.unifiSite}/stat/guest`);
  return res.data ?? [];
}

export type UniFiStation = {
  mac: string;
  _id?: string; // the client/user record id — target for /rest/user updates (usergroup)
  usergroup_id?: string; // the user group this client is currently in
  hostname?: string;
  name?: string; // user-set alias in the UniFi UI, if any — prefer over hostname when present
  ap_mac?: string;
  sw_mac?: string; // wired: the switch the client is plugged into
  sw_port?: number; // wired: the switch port
  essid?: string;
  ip?: string;
  is_wired?: boolean;
  oui?: string; // vendor name the controller resolved from the MAC OUI
  rssi?: number; // classic API: dB above noise (SNR-ish), higher = better
  signal?: number; // dBm, wireless clients
  noise?: number; // dBm, wireless clients
  vlan?: number;
  network?: string; // network display name, when the controller includes it
  network_id?: string; // networkconf _id — resolve via listNetworks()
  rx_bytes?: number;
  tx_bytes?: number;
  // Presence window (epoch seconds) — drives the duplicate-IP session-overlap check.
  assoc_time?: number;
  last_seen?: number;
  uptime?: number; // seconds since association
};

/**
 * All currently-connected clients (not just authorized guests) — GET /stat/sta.
 * Falls back to the Integration API (basic fields only) when the cookie
 * session fails and an API key is configured, so monitoring degrades instead
 * of going dark.
 */
export async function listStations(): Promise<UniFiStation[]> {
  try {
    const { cfg } = await ensureSession();
    const res = await unifiRequest<{ data: UniFiStation[] }>(`/api/s/${cfg.unifiSite}/stat/sta`);
    return res.data ?? [];
  } catch (err) {
    const cfg = await getPortalConfig();
    if (!cfg.unifiApiKey) throw err;
    console.error("listStations: cookie session failed, using Integration API fallback:", err instanceof Error ? err.message : err);
    return listStationsViaIntegration();
  }
}

export type UniFiNetwork = {
  _id: string;
  name: string;
  vlan?: number;
  purpose?: string; // "corporate" | "guest" | "wan" | ...
  wan_networkgroup?: string; // "WAN" | "WAN2" — ties a wan-purpose network to its gateway interface
  // DHCP server config, for pool-exhaustion checks.
  dhcpd_enabled?: boolean;
  dhcpd_start?: string; // first pool IP
  dhcpd_stop?: string; // last pool IP
  // DNS servers handed out by DHCP (manual mode) — the firewall planner keeps
  // them reachable across guest isolation.
  dhcpd_dns_enabled?: boolean;
  dhcpd_dns_1?: string;
  dhcpd_dns_2?: string;
  dhcpd_dns_3?: string;
  dhcpd_dns_4?: string;
  ip_subnet?: string; // e.g. "10.90.0.1/24"
};

/** Configured networks, for mapping a station's network_id to a name/VLAN. */
export async function listNetworks(): Promise<UniFiNetwork[]> {
  const { cfg } = await ensureSession();
  const res = await unifiRequest<{ data: UniFiNetwork[] }>(`/api/s/${cfg.unifiSite}/rest/networkconf`);
  return res.data ?? [];
}

export type UniFiFirewallRule = {
  _id?: string;
  ruleset?: string;
  rule_index?: number | string;
  name?: string;
  action?: string;
  enabled?: boolean;
  protocol?: string;
  src_address?: string;
  dst_address?: string;
  dst_port?: string;
};

/** User-defined classic firewall rules (zone-based controllers reject this endpoint). */
export async function listFirewallRules(): Promise<UniFiFirewallRule[]> {
  const { cfg } = await ensureSession();
  const res = await unifiRequest<{ data: UniFiFirewallRule[] }>(`/api/s/${cfg.unifiSite}/rest/firewallrule`);
  return res.data ?? [];
}

/** Create one classic firewall rule; throws with the controller's message on rejection. */
export async function createFirewallRule(rule: Record<string, unknown>): Promise<void> {
  const { cfg } = await ensureSession();
  await unifiRequest(`/api/s/${cfg.unifiSite}/rest/firewallrule`, { method: "POST", body: rule });
}

// --- Zone-based firewall (UniFi Network 9+) --------------------------------
// ZBF controllers reject classic /rest/firewallrule writes (every legacy
// rule_index is "out of range"); rules live as policies between zones on the
// v2 API instead. v2 endpoints return bare JSON (no {data} wrapper) — but
// normalize both shapes defensively.

export type UniFiFirewallZone = {
  _id: string;
  name?: string;
  network_ids?: string[];
  default_zone?: boolean;
};

function v2List<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const data = (res as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

export type ZoneProbe = { path: string; ok: boolean; count: number; error?: string; sampleKeys?: string[] };

/**
 * Locate the firewall zones across the endpoint variants seen on UniFi
 * Network 9.x builds; returns whichever answered with zone-shaped items plus
 * a probe log for diagnostics when none did.
 */
export async function findFirewallZones(): Promise<{ zones: UniFiFirewallZone[]; probes: ZoneProbe[] }> {
  const { cfg } = await ensureSession();
  const candidates = [
    `/v2/api/site/${cfg.unifiSite}/firewall/zones`,
    `/v2/api/site/${cfg.unifiSite}/firewall-zones`,
    `/v2/api/site/${cfg.unifiSite}/firewall/zone`,
  ];
  const probes: ZoneProbe[] = [];
  for (const path of candidates) {
    try {
      const res = await unifiRequest(path);
      let list = v2List<UniFiFirewallZone>(res);
      const zonesField = (res as { zones?: unknown })?.zones;
      if (!list.length && Array.isArray(zonesField)) list = zonesField as UniFiFirewallZone[];
      probes.push({
        path,
        ok: true,
        count: list.length,
        sampleKeys: list[0] ? Object.keys(list[0]).slice(0, 12) : [],
      });
      if (list.length && list.every((z) => typeof z._id === "string")) return { zones: list, probes };
    } catch (e) {
      probes.push({
        path,
        ok: false,
        count: 0,
        error: (e instanceof Error ? e.message : String(e)).slice(0, 160),
      });
    }
  }
  return { zones: [], probes };
}

export type UniFiFirewallPolicy = {
  _id?: string;
  name?: string;
  index?: number;
  predefined?: boolean;
  action?: string;
  enabled?: boolean;
  protocol?: string;
  /** Full endpoint objects, kept loose — used as ground-truth schema samples in apply diagnostics. */
  source?: Record<string, unknown>;
  destination?: Record<string, unknown>;
};

export async function listFirewallPolicies(): Promise<UniFiFirewallPolicy[]> {
  const { cfg } = await ensureSession();
  return v2List(await unifiRequest(`/v2/api/site/${cfg.unifiSite}/firewall-policies`));
}

/** Create one zone-based firewall policy; throws with the controller's message on rejection. */
export async function createFirewallPolicy(policy: Record<string, unknown>): Promise<void> {
  const { cfg } = await ensureSession();
  await unifiRequest(`/v2/api/site/${cfg.unifiSite}/firewall-policies`, { method: "POST", body: policy });
}

/** Delete one zone-based firewall policy. Endpoint shape mirrors the list/create
 * pair; not yet exercised against a live controller — the cleanup route
 * surfaces the controller's error verbatim if this 404s/400s. */
export async function deleteFirewallPolicy(id: string): Promise<void> {
  const { cfg } = await ensureSession();
  await unifiRequest(`/v2/api/site/${cfg.unifiSite}/firewall-policies/${id}`, { method: "DELETE" });
}

/** Delete one classic firewall rule. */
export async function deleteFirewallRule(id: string): Promise<void> {
  const { cfg } = await ensureSession();
  await unifiRequest(`/api/s/${cfg.unifiSite}/rest/firewallrule/${id}`, { method: "DELETE" });
}

/** Raw per-section site settings (/rest/setting) — each row is one section
 * (`key`: "mgmt", "ips", "usg", …) with section-specific fields. Read-only
 * input for the config health check. */
export type UniFiSiteSetting = { key?: string } & Record<string, unknown>;

export async function listSiteSettings(): Promise<UniFiSiteSetting[]> {
  const { cfg } = await ensureSession();
  const res = await unifiRequest<{ data: UniFiSiteSetting[] }>(`/api/s/${cfg.unifiSite}/rest/setting`);
  return res.data ?? [];
}

/**
 * Detect which firewall engine the controller runs. Two independent signals:
 * the firewall-policies list answering with entries marks it zone-based (so a
 * doomed classic write is never attempted), and the zones lookup provides
 * what policy creation needs. `zbfDetected && zones.length === 0` is the
 * degenerate case the probes log exists to diagnose.
 */
export async function detectFirewallEngine(): Promise<{
  zbfDetected: boolean;
  zones: UniFiFirewallZone[];
  probes: ZoneProbe[];
}> {
  const policies = await listFirewallPolicies().catch(() => null);
  const { zones, probes } = await findFirewallZones().catch(() => ({ zones: [], probes: [] as ZoneProbe[] }));
  return { zbfDetected: (policies !== null && policies.length > 0) || zones.length > 0, zones, probes };
}

/**
 * Lookup maps for labelling stations: MAC → device name (resolve `sw_mac` /
 * `ap_mac`) and network `_id` → name (resolve `network_id`). Each source is
 * fetched with its own fallback so a partial controller outage still yields
 * whatever it can rather than throwing.
 */
export async function getNameMaps(): Promise<{
  deviceName: Map<string, string>;
  deviceMacs: Set<string>;
  networkNameById: Map<string, string>;
}> {
  const [devices, networks] = await Promise.all([
    listDevices().catch(() => []),
    listNetworks().catch(() => []),
  ]);
  // deviceMacs holds EVERY MAC an adopted device answers with — base MAC plus
  // per-interface MACs (ethernet_table) and per-SSID BSSIDs (vap_table), which
  // are often locally-administered and unrelated-looking. stat/sta lists any
  // of them as wired/wireless clients, and callers need the full set to keep
  // infrastructure out of client-facing tables (block-sta refuses them all).
  // Stored in physicalMacForm because devices ALSO use virtual MACs that the
  // tables don't list, derived from the base MAC via the locally-administered
  // bit — membership tests must apply physicalMacForm to the probed MAC too.
  const deviceMacs = new Set<string>();
  const deviceName = new Map<string, string>();
  for (const dev of devices) {
    deviceMacs.add(physicalMacForm(dev.mac));
    for (const eth of dev.ethernet_table ?? []) if (eth.mac) deviceMacs.add(physicalMacForm(eth.mac));
    for (const vap of dev.vap_table ?? []) if (vap.bssid) deviceMacs.add(physicalMacForm(vap.bssid));
    if (dev.name) deviceName.set(dev.mac.toLowerCase(), dev.name);
  }
  const networkNameById = new Map<string, string>();
  for (const net of networks) networkNameById.set(net._id, net.name);
  return { deviceName, deviceMacs, networkNameById };
}

export type UniFiDevice = {
  mac: string;
  name?: string;
  type?: string; // "uap" | "usw" | "ugw" | ...
  model?: string;
};

/** Access points on the site, for mapping a station's ap_mac to a display name. */
export async function listAccessPoints(): Promise<UniFiDevice[]> {
  const { cfg } = await ensureSession();
  const res = await unifiRequest<{ data: UniFiDevice[] }>(`/api/s/${cfg.unifiSite}/stat/device`);
  return (res.data ?? []).filter((d) => d.type === "uap");
}

export type UniFiRadioStat = {
  radio?: string; // "ng" (2.4 GHz) | "na" (5 GHz) | "6e" (6 GHz)
  channel?: number;
  cu_total?: number; // channel utilization %
  num_sta?: number;
  satisfaction?: number;
};

export type UniFiPort = {
  port_idx?: number;
  name?: string;
  up?: boolean;
  enable?: boolean; // false = administratively disabled
  is_uplink?: boolean; // the port carrying this device's uplink
  speed?: number; // Mbps (negotiated link speed)
  poe_power?: string; // watts as string, when PoE is *actively* delivering
  port_poe?: boolean; // the port is PoE-*capable* (true even when nothing is drawing)
  poe_enable?: boolean; // PoE administratively enabled on this port
  poe_mode?: string; // "auto" | "pasv24" | "passthrough" | "off"
  // Live throughput (bytes/sec) — drives the link-saturation rule:
  "rx_bytes-r"?: number;
  "tx_bytes-r"?: number;
  // Cumulative counters (since boot) — drive the interface-error rule:
  rx_packets?: number;
  tx_packets?: number;
  rx_errors?: number;
  tx_errors?: number;
  rx_dropped?: number;
  tx_dropped?: number;
  // VLAN behavior of the port:
  forward?: string; // "all" | "customize" | "native" | "disabled"
  native_networkconf_id?: string;
  tagged_vlan_mgmt?: string; // "auto" (allow all) | "block_all" | "custom"
  excluded_networkconf_ids?: string[]; // blocked tagged networks
  portconf_id?: string; // the port profile applied to this port (resolve via listPortConfs)
};

/** A switch port profile (Ports settings) — /rest/portconf. */
export type UniFiPortConf = {
  _id: string;
  name: string;
};

/** All configured port profiles, for resolving a port's portconf_id to a name. */
export async function listPortConfs(): Promise<UniFiPortConf[]> {
  const { cfg } = await ensureSession();
  const res = await unifiRequest<{ data: UniFiPortConf[] }>(`/api/s/${cfg.unifiSite}/rest/portconf`);
  return res.data ?? [];
}

export type UniFiUplink = {
  type?: string; // "wire" | "wireless"
  uplink_mac?: string;
  uplink_remote_port?: number;
};

/** One WAN interface on the gateway (`wan1`/`wan2` on stat/device). */
export type UniFiWanLink = {
  up?: boolean;
  enable?: boolean; // false = interface administratively off
  ip?: string;
  name?: string; // user label, or "WAN"/"WAN2"
  ifname?: string;
  type?: string; // "dhcp" | "static" | "pppoe"
  isp_name?: string;
  gateway?: string;
  // Per-WAN speedtest results, when the controller records them per interface
  // (field names vary by firmware; read defensively). Mbps + ms.
  xput_up?: number;
  xput_down?: number;
  speedtest_ping?: number;
  speedtest_lastrun?: number; // epoch seconds
};

export type UniFiDeviceHealth = {
  mac: string;
  name?: string;
  type?: string; // "uap" | "usw" | "udm" | "ugw" | ...
  model?: string;
  ip?: string;
  state?: number; // 0 offline, 1 connected, 2 pending adoption, 4 upgrading, 5 provisioning, ...
  version?: string;
  upgradable?: boolean;
  uptime?: number; // seconds
  last_seen?: number; // epoch seconds of the last controller contact
  num_sta?: number;
  satisfaction?: number;
  "system-stats"?: { cpu?: string; mem?: string };
  // Environmental sensors, model/firmware-dependent; many devices report none
  // of these. Verify per model via /api/admin/devices/{mac}/raw before
  // building on a field.
  general_temperature?: number; // °C, single-sensor devices
  overheating?: boolean;
  fan_level?: number;
  temperatures?: { name?: string; type?: string; value?: number }[]; // multi-sensor devices (gateways)
  total_max_power?: number; // switches: PoE budget in watts
  // Config-sync fingerprints: known_cfgversion is the config hash the device
  // last acknowledged; cfgversion is the controller's current one. A mismatch
  // means a site-wide setting (SNMP included) hasn't reached this device yet
  // — reprovision it. Unverified on this controller version; degrades to
  // silence (no comparison) when either is absent.
  cfgversion?: string;
  known_cfgversion?: string;
  radio_table_stats?: UniFiRadioStat[];
  port_table?: UniFiPort[];
  uplink?: UniFiUplink;
  last_uplink?: UniFiUplink; // remembered while the device is offline
  locating?: boolean; // LED is currently blinking (locate on)
  // Secondary MACs a device answers with besides `mac`: per-interface
  // (ethernet_table) and per-SSID BSSIDs (vap_table). Any of them can appear
  // in stat/sta as a "client", and block-sta refuses all of them.
  ethernet_table?: { mac?: string; name?: string }[];
  vap_table?: { bssid?: string }[];
  // Gateways only: per-WAN interface state + the controller's per-WAN uptime
  // monitors (keyed "WAN"/"WAN2"). Drive the multi-WAN view + wan_link alerts.
  wan1?: UniFiWanLink;
  wan2?: UniFiWanLink;
  uptime_stats?: Record<string, { availability?: number; latency_average?: number }>;
};

/**
 * Every adopted device (APs, switches, gateway) with health fields —
 * GET /stat/device. Same Integration-API fallback as listStations: the mapped
 * rows carry only name/model/ip/state/firmware, so threshold rules that need
 * system-stats or port_table simply see no data (and stay quiet) while the
 * cookie session is down.
 */
export async function listDevices(): Promise<UniFiDeviceHealth[]> {
  try {
    const { cfg } = await ensureSession();
    const res = await unifiRequest<{ data: UniFiDeviceHealth[] }>(`/api/s/${cfg.unifiSite}/stat/device`);
    return res.data ?? [];
  } catch (err) {
    const cfg = await getPortalConfig();
    if (!cfg.unifiApiKey) throw err;
    console.error("listDevices: cookie session failed, using Integration API fallback:", err instanceof Error ? err.message : err);
    return listDevicesViaIntegration();
  }
}

export type UniFiSubsystemHealth = {
  subsystem: string; // "wlan" | "lan" | "wan" | "www" | "vpn"
  status?: string; // "ok" | "warning" | "error" | "unknown"
  num_user?: number;
  num_guest?: number;
  num_ap?: number;
  num_sw?: number;
  num_gw?: number;
  num_adopted?: number;
  num_disconnected?: number;
  wan_ip?: string;
  gw_name?: string;
  latency?: number; // ms, on "www"
  uptime?: number; // seconds, on "www"
  xput_up?: number; // Mbps (last speedtest), on "www"
  xput_down?: number;
  "tx_bytes-r"?: number; // current bytes/s
  "rx_bytes-r"?: number;
};

/** Site health per subsystem — GET /stat/health. */
export async function getSiteHealth(): Promise<UniFiSubsystemHealth[]> {
  const { cfg } = await ensureSession();
  const res = await unifiRequest<{ data: UniFiSubsystemHealth[] }>(`/api/s/${cfg.unifiSite}/stat/health`);
  return res.data ?? [];
}

export type UniFiEvent = {
  key?: string; // e.g. EVT_SW_PortLinkUp / EVT_AP_Lost_Contact / EVT_GW_WANTransition
  time?: number; // epoch ms
  msg?: string; // human text, often carries the port ("Port 5 link down")
  sw?: string; // switch MAC, on switch events
  ap?: string; // AP MAC, on AP events
  gw?: string; // gateway MAC, on gateway events
  sw_name?: string;
  ap_name?: string;
  gw_name?: string;
  port?: number | string; // some firmware versions include it directly
  // Client events (EVT_WU_*/EVT_WG_*/EVT_LU_*): the client MAC rides in
  // `user` (LAN/WLAN users) or `guest` (guest-authorized clients).
  user?: string;
  guest?: string;
  hostname?: string;
  ssid?: string;
  channel?: number | string;
};

/**
 * Controller event log — POST /stat/event. This is where link up/down,
 * device lost-contact/restart, and WAN transitions live; the controller
 * retains them, so flap detection needs no local storage.
 */
export async function listControllerEvents(withinHours: number, limit = 500): Promise<UniFiEvent[]> {
  const { cfg } = await ensureSession();
  const res = await unifiRequest<{ data: UniFiEvent[] }>(`/api/s/${cfg.unifiSite}/stat/event`, {
    method: "POST",
    body: { _limit: limit, within: withinHours, _sort: "-time" },
  });
  return res.data ?? [];
}

export type UniFiAlarm = {
  _id?: string;
  key?: string; // alarm type key; duplicate-IP wording varies by firmware
  time?: number; // epoch ms
  datetime?: string;
  msg?: string; // human text — often the only carrier of the IP/MACs/VLAN
  archived?: boolean;
  // Structured fields appear on some firmwares; the dupIp parser reads them
  // defensively, so the type stays open:
  [k: string]: unknown;
};

/**
 * Unarchived controller alarms (duplicate-IP entries live here). The classic
 * GET /stat/alarm was REMOVED in Network Application 10.x (404
 * api.err.NotFound), which spammed the dup-IP monitor's logs every cycle — so
 * fall back to the v2 alarms endpoint, then degrade to empty rather than throw
 * when neither exists (the dup-IP monitor has other signals).
 */
// Some controllers (Network Application 10.4.x) expose NEITHER alarm endpoint.
// Probing both every dup-IP cycle produced two 404s and a log line every two
// minutes forever. Remember the verdict, say it once, and re-probe rarely in
// case a firmware upgrade brings the endpoint back.
const ALARM_REPROBE_MS = 6 * 60 * 60 * 1000;
let alarmsUnsupportedUntil = 0;

export async function listAlarms(limit = 500): Promise<UniFiAlarm[]> {
  if (Date.now() < alarmsUnsupportedUntil) return [];
  const { cfg } = await ensureSession();
  const notFound = (err: unknown) => /\(404\)|NotFound/i.test(err instanceof Error ? err.message : "");

  try {
    const res = await unifiRequest<{ data: UniFiAlarm[] }>(
      `/api/s/${cfg.unifiSite}/stat/alarm?archived=false&_limit=${limit}`,
    );
    return res.data ?? [];
  } catch (err) {
    if (!notFound(err)) throw err; // a real error (auth/network) still propagates
  }

  // Network Application 9/10+: v2 alarms. Shape is a bare array or {data:[]}.
  try {
    const v2 = await unifiRequest<unknown>(`/v2/api/site/${cfg.unifiSite}/alarms?archived=false`);
    if (Array.isArray(v2)) return v2 as UniFiAlarm[];
    const data = (v2 as { data?: UniFiAlarm[] })?.data;
    return Array.isArray(data) ? data : [];
  } catch (err) {
    const first = alarmsUnsupportedUntil === 0;
    alarmsUnsupportedUntil = Date.now() + ALARM_REPROBE_MS;
    if (first) {
      console.warn(
        "listAlarms: neither the classic nor v2 alarm endpoint exists on this controller; " +
          `alarm-derived checks are disabled and will be re-probed in ${ALARM_REPROBE_MS / 3_600_000}h —`,
        err instanceof Error ? err.message : err,
      );
    }
    return [];
  }
}

export type UserHourlyStat = {
  time: number; // epoch ms, start of the hour
  mac: string;
  rxBytes: number;
  txBytes: number;
};

/**
 * Per-client hourly usage from the controller's report store —
 * POST /stat/report/hourly.user. The controller identifies the client in a
 * `user` (or `oid`) field, not `mac`, and byte counts can be floats.
 * Retention is controller-side (typically ~30 days of hourly data).
 */
export async function getHourlyUserStats(
  macs: string[],
  startMs: number,
  endMs: number,
): Promise<UserHourlyStat[]> {
  if (macs.length === 0) return [];
  const { cfg } = await ensureSession();
  const res = await unifiRequest<{ data: Array<Record<string, unknown>> }>(
    `/api/s/${cfg.unifiSite}/stat/report/hourly.user`,
    {
      method: "POST",
      body: {
        attrs: ["time", "rx_bytes", "tx_bytes"],
        start: startMs,
        end: endMs,
        macs: macs.map((m) => m.toLowerCase()),
      },
    },
  );
  return (res.data ?? []).flatMap((row) => {
    const mac = (row.user ?? row.oid ?? row.mac) as string | undefined;
    const time = row.time as number | undefined;
    if (!mac || !time) return [];
    return [{
      time,
      mac: mac.toLowerCase(),
      rxBytes: Number(row.rx_bytes ?? 0),
      txBytes: Number(row.tx_bytes ?? 0),
    }];
  });
}

export type SiteDailyStat = {
  time: number; // epoch ms, start of the day
  wlanBytes: number;
  wlanClients: number;
};

/** Site-wide daily WLAN traffic + client counts — POST /stat/report/daily.site. */
export async function getDailySiteStats(startMs: number, endMs: number): Promise<SiteDailyStat[]> {
  const { cfg } = await ensureSession();
  const res = await unifiRequest<{ data: Array<Record<string, unknown>> }>(
    `/api/s/${cfg.unifiSite}/stat/report/daily.site`,
    {
      method: "POST",
      body: { attrs: ["time", "wlan_bytes", "wlan-num_sta"], start: startMs, end: endMs },
    },
  );
  return (res.data ?? []).flatMap((row) => {
    const time = row.time as number | undefined;
    if (!time) return [];
    return [{
      time,
      wlanBytes: Number(row.wlan_bytes ?? 0),
      wlanClients: Number(row["wlan-num_sta"] ?? 0),
    }];
  });
}

export type UniFiClientSession = {
  mac: string;
  ap_mac?: string;
  assoc_time?: number; // epoch seconds
  duration?: number; // seconds
  rx_bytes?: number;
  tx_bytes?: number;
  hostname?: string;
  name?: string;
  ip?: string;
};

/** Connection sessions for one client — POST /stat/session (start/end in epoch seconds). */
export async function getClientSessions(
  mac: string,
  startSec: number,
  endSec: number,
): Promise<UniFiClientSession[]> {
  const { cfg } = await ensureSession();
  const res = await unifiRequest<{ data: UniFiClientSession[] }>(
    `/api/s/${cfg.unifiSite}/stat/session`,
    { method: "POST", body: { type: "all", mac: mac.toLowerCase(), start: startSec, end: endSec } },
  );
  return res.data ?? [];
}

/**
 * The site's "guest_access" settings section (hotspot portal config) —
 * GET /get/setting returns every section; we want just this one.
 */
export async function getGuestAccessSetting(): Promise<Record<string, unknown> | null> {
  const { cfg } = await ensureSession();
  const res = await unifiRequest<{ data: Array<Record<string, unknown>> }>(
    `/api/s/${cfg.unifiSite}/get/setting`,
  );
  return (res.data ?? []).find((s) => s.key === "guest_access") ?? null;
}

/**
 * "Does the controller's value satisfy the desired one?" — absent compares
 * equal to a cleared string AND to boolean false, because a section that
 * never had a key (older controller) is the same as one where it's off/blank;
 * without this, applying `voucher_enabled: false` to a section lacking the
 * field would verify as "didn't stick" forever.
 */
export function settingEq(current: unknown, want: unknown): boolean {
  const cur = current ?? (typeof want === "boolean" ? false : "");
  return cur === (want ?? "");
}

/**
 * Partial update of the guest_access section — only the provided keys change.
 * Verified: some controller versions answer 200 OK to the plain
 * `set/setting/guest_access` form without persisting anything, so after
 * writing we re-read the section and compare. If the patch didn't stick, we
 * retry the `_id`-addressed form those versions require — and if it STILL
 * doesn't stick, we throw, so "Applied" is never reported for a write the
 * controller ignored.
 */
export async function updateGuestAccessSetting(patch: Record<string, unknown>): Promise<void> {
  const { cfg } = await ensureSession();
  const before = await getGuestAccessSetting();
  const sectionId = typeof before?._id === "string" ? (before._id as string) : null;

  const stuck = (section: Record<string, unknown> | null) =>
    Object.entries(patch).every(([k, v]) => settingEq(section?.[k], v));

  await unifiRequest(`/api/s/${cfg.unifiSite}/set/setting/guest_access`, {
    method: "POST",
    body: patch,
  });
  if (stuck(await getGuestAccessSetting())) return;

  if (sectionId) {
    await unifiRequest(`/api/s/${cfg.unifiSite}/set/setting/guest_access/${sectionId}`, {
      method: "POST",
      body: patch,
    });
    if (stuck(await getGuestAccessSetting())) return;
  }

  throw new Error(
    "The controller accepted the guest-portal update but the settings did not change. " +
      "Apply them manually in UniFi (Settings → Hotspot) and report the controller version.",
  );
}

/** A neighbouring AP the site's radios saw in a scan — GET /stat/rogueap. */
export type UniFiRogueAp = {
  bssid: string;
  essid?: string; // SSID; empty/absent = hidden
  channel?: number;
  radio?: string; // "ng" | "na" | ...
  rssi?: number; // dBm-ish signal
  signal?: number;
  security?: string; // "open" | "wep" | "wpa" | "wpa2" | ...
  band?: string;
  oui?: string; // vendor
  ap_mac?: string; // which of OUR APs saw it
  is_ubnt?: boolean; // Ubiquiti hardware
  age?: number; // seconds since last seen
  last_seen?: number; // epoch seconds
};

/** Neighbouring APs seen by the site's radios (the controller's own scan). */
export async function listRogueAps(): Promise<UniFiRogueAp[]> {
  const { cfg } = await ensureSession();
  const res = await unifiRequest<{ data: UniFiRogueAp[] }>(`/api/s/${cfg.unifiSite}/stat/rogueap`);
  return res.data ?? [];
}

export type UniFiWlan = {
  _id: string;
  name: string;
  enabled?: boolean;
  is_guest?: boolean;
  networkconf_id?: string; // the network/VLAN clients of this SSID land on
  // Security posture (config health check) — loose optionals; absent on
  // controllers that don't expose them.
  security?: string; // "open" | "wpapsk" | "wpaeap" | ...
  wpa_mode?: string; // "wpa1" | "wpa2" | "wpa3" ...
  pmf_mode?: string; // "disabled" | "optional" | "required"
  x_passphrase?: string; // never surfaced — presence only
};

export async function listWlans(): Promise<UniFiWlan[]> {
  const { cfg } = await ensureSession();
  const res = await unifiRequest<{ data: UniFiWlan[] }>(`/api/s/${cfg.unifiSite}/rest/wlanconf`);
  return res.data ?? [];
}

/** Toggle "apply guest policies" (hotspot portal) on one SSID. */
export async function setWlanGuestPolicy(wlanId: string, isGuest: boolean): Promise<void> {
  const { cfg } = await ensureSession();
  await unifiRequest(`/api/s/${cfg.unifiSite}/rest/wlanconf/${wlanId}`, {
    method: "PUT",
    body: { is_guest: isGuest },
  });
}

export type TrafficAppUsage = {
  application: number;
  category: number;
  bytes_received?: number;
  bytes_transmitted?: number;
  total_bytes?: number;
  activity_seconds?: number;
};

export type ClientTraffic = {
  client: { mac: string; hostname?: string; name?: string; oui?: string; is_wired?: boolean };
  usage_by_app: TrafficAppUsage[];
};

/**
 * Per-client DPI usage from the v2 traffic API (UniFi OS gateways with
 * Traffic Identification enabled). `mac` limits to one client; omit for the
 * whole site. Times are epoch ms.
 */
export async function getDpiTraffic(
  startMs: number,
  endMs: number,
  mac?: string,
): Promise<ClientTraffic[]> {
  const { cfg } = await ensureSession();
  const path =
    `/v2/api/site/${cfg.unifiSite}/traffic` +
    (mac ? `/${mac.toLowerCase()}` : "") +
    `?start=${startMs}&end=${endMs}`;
  const res = await unifiRequest<{ client_usage_by_app?: ClientTraffic[] }>(path);
  return res.client_usage_by_app ?? [];
}

// Device management commands (cmd/devmgr). These act on the controller, so
// they work even when a device is wedged/offline (the controller relays or
// queues them). Callers resolve the device by MAC first.
async function devmgr(cmd: string, extra: Record<string, unknown>): Promise<void> {
  const { cfg } = await ensureSession();
  await unifiRequest(`/api/s/${cfg.unifiSite}/cmd/devmgr`, {
    method: "POST",
    body: { cmd, ...extra },
  });
}

/** Reboot an adopted device. */
export async function restartDevice(mac: string): Promise<void> {
  await devmgr("restart", { mac: mac.toLowerCase() });
}

/** Power-cycle a single PoE port (resets a downstream device without touching the switch). */
export async function powerCyclePort(mac: string, portIdx: number): Promise<void> {
  await devmgr("power-cycle", { mac: mac.toLowerCase(), port_idx: portIdx });
}

/** Blink the device LED(s) to physically locate it. */
export async function locateDevice(mac: string, on: boolean): Promise<void> {
  await devmgr(on ? "set-locate" : "unset-locate", { mac: mac.toLowerCase() });
}

/**
 * Raw config collections for the config-history snapshots — the FULL objects
 * as the controller returns them, not the trimmed shapes the feature helpers
 * expose. Best-effort per collection: an endpoint a controller version lacks
 * simply drops out of the bundle (and out of the diff).
 */
export async function fetchConfigCollections(): Promise<Record<string, unknown>> {
  const { cfg } = await ensureSession();
  const site = cfg.unifiSite;
  const classic: Record<string, string> = {
    networks: `/api/s/${site}/rest/networkconf`,
    wlans: `/api/s/${site}/rest/wlanconf`,
    portProfiles: `/api/s/${site}/rest/portconf`,
    userGroups: `/api/s/${site}/rest/usergroup`,
    firewallRules: `/api/s/${site}/rest/firewallrule`,
    firewallGroups: `/api/s/${site}/rest/firewallgroup`,
    settings: `/api/s/${site}/rest/setting`,
  };
  const out: Record<string, unknown> = {};
  for (const [key, path] of Object.entries(classic)) {
    try {
      out[key] = (await unifiRequest<{ data?: unknown[] }>(path)).data ?? [];
    } catch {
      /* collection unavailable on this controller — drop it */
    }
  }
  // Zone-based firewall policies (Network 9+): a bare array on the v2 API.
  try {
    const v2 = await unifiRequest<unknown>(`/v2/api/site/${site}/firewall-policies`);
    out.firewallPolicies = Array.isArray(v2) ? v2 : ((v2 as { data?: unknown[] })?.data ?? []);
  } catch {
    /* v2 policies unavailable — classic-only controller */
  }
  return out;
}

/**
 * Trigger a controller backup (settings-only, days=0) and download the .unf.
 * The file is the operator's restore artifact — stored/streamed opaque, never
 * parsed or pushed back.
 */
export async function downloadControllerBackup(): Promise<Buffer> {
  const res = await unifiRequest<{ data?: Array<{ url?: string }> }>(
    `/api/s/${(await ensureSession()).cfg.unifiSite}/cmd/backup`,
    { method: "POST", body: { cmd: "backup", days: 0 } },
  );
  const url = res.data?.[0]?.url;
  if (!url) throw new Error("Controller returned no backup URL");

  const { session, cfg } = await ensureSession();
  const base = cfg.unifiUrl.replace(/\/$/, "");
  const fullPath = session.usesProxy ? `/proxy/network${url}` : url;
  const headers: Record<string, string> = { cookie: session.cookieHeader };
  if (session.csrfToken) headers["x-csrf-token"] = session.csrfToken;
  const dl = await undiciFetch(`${base}${fullPath}`, {
    headers,
    dispatcher: getDispatcher(cfg.unifiInsecureTls),
  });
  if (!dl.ok) throw new Error(`Backup download failed (${dl.status})`);
  return Buffer.from(await dl.arrayBuffer());
}

export function clearUniFiSession(): void {
  cachedSession = null;
  cachedDispatcher = null;
  cachedIntegrationSiteId = null;
  // Changed settings may point at a different controller — re-probe alarms.
  alarmsUnsupportedUntil = 0;
}
