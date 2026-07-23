import http from "k6/http";
import { check, fail, sleep } from "k6";
import exec from "k6/execution";

/**
 * Guest-registration load test against the e2e topology (mock controller).
 * Two modes, picked with MODE:
 *
 * MODE=burst (default): N concurrent guests hammering POST
 * /api/portal/authorize in a closed loop. Worst-case stampede shape.
 * Tunables: VUS (peak concurrent, 150), RAMP (30s), HOLD (60s), THINK
 * (per-VU pause between registrations in seconds, 0).
 *
 * MODE=event: GUESTS total guests arriving over WINDOW, shaped like a real
 * event (ramp up 20% of the window, hold 50%, tail off 30%). Each guest
 * loads the captive page, "fills the form" for 1-4s, then registers.
 * Tunables: GUESTS (3000), WINDOW (10m).
 *
 * Both modes measure the PORTAL's behavior (pool queueing, audit
 * serialization, login single-flight); against the local mock controller
 * the controller side is instant. Run via test/load/run.sh or
 * test/load/simulate-event.sh.
 *
 * TARGET=<base url> points the same test at a portal running ANYWHERE
 * (run from a separate machine via test/load/remote-run.sh). Remote runs
 * skip the bootstrap entirely: the target must already be configured, and
 * every registration is REAL on that system. INSECURE=1 skips TLS
 * verification (self-signed target), P95_MS overrides the 2s authorize
 * threshold, SITE overrides the captive-page site slug.
 */

const TARGET = __ENV.TARGET || "";
const REMOTE = TARGET !== "";
const BASE = TARGET || __ENV.BASE_URL || "http://portal:3000";
const SITE = __ENV.SITE || "default";
const BOOTSTRAP_PW = __ENV.ADMIN_BOOTSTRAP_PASSWORD || "e2e-bootstrap-pw";
const MOCK_URL = __ENV.MOCK_URL || "http://mock-unifi:9080";
const ADMIN_USER = "loadadmin";
const ADMIN_PASS = "load-password-1";
const MODE = (__ENV.MODE || "burst").toLowerCase();
const VUS = Number(__ENV.VUS || 150);
const GUESTS = Number(__ENV.GUESTS || 3000);

/** "90", "90s", "10m", "1h" -> seconds. */
function durationSeconds(raw) {
  const m = String(raw).trim().match(/^(\d+(?:\.\d+)?)(s|m|h)?$/);
  if (!m) fail(`bad duration: ${raw}`);
  return Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2] || "s"];
}

const WINDOW_S = durationSeconds(__ENV.WINDOW || "10m");
// Event shape: ramp 0->peak over 20% of the window, hold 50%, tail 30%.
// Area under that curve is 0.75 * peak * window = GUESTS. Rates are quoted
// per RATE_UNIT (10s), not per second, so a small total isn't inflated by
// rounding a fractional per-second target up to a whole number — e.g. 50
// guests over 2m lands near 50, not ~90.
const RATE_UNIT_S = 10;
const PEAK_RATE = Math.max(1, Math.round((4 * GUESTS * RATE_UNIT_S) / (3 * WINDOW_S)));
const PEAK_PER_S = PEAK_RATE / RATE_UNIT_S;

const scenarios =
  MODE === "event"
    ? {
        event: {
          executor: "ramping-arrival-rate",
          startRate: 0,
          timeUnit: `${RATE_UNIT_S}s`,
          // Iterations run ~5s (page + think + register); size the VU pool
          // for the per-second rate, with headroom for latency growth.
          preAllocatedVUs: Math.min(500, Math.ceil(PEAK_PER_S * 8) + 10),
          maxVUs: Math.min(1000, Math.ceil(PEAK_PER_S * 20) + 20),
          stages: [
            { duration: `${Math.round(WINDOW_S * 0.2)}s`, target: PEAK_RATE },
            { duration: `${Math.round(WINDOW_S * 0.5)}s`, target: PEAK_RATE },
            { duration: `${Math.round(WINDOW_S * 0.3)}s`, target: 0 },
          ],
        },
      }
    : {
        burst: {
          executor: "ramping-vus",
          startVUs: 0,
          stages: [
            { duration: __ENV.RAMP || "30s", target: VUS },
            { duration: __ENV.HOLD || "60s", target: VUS },
            { duration: "10s", target: 0 },
          ],
        },
      };

export const options = {
  scenarios,
  insecureSkipTLSVerify: __ENV.INSECURE === "1",
  thresholds: {
    // A failed registration is a guest staring at an error page.
    http_req_failed: ["rate<0.01"],
    "http_req_duration{endpoint:authorize}": [`p(95)<${Number(__ENV.P95_MS || 2000)}`],
  },
};

const JSON_HDRS = { headers: { "Content-Type": "application/json" } };

function adminLogin(username, password) {
  return http.post(
    `${BASE}/api/admin/login`,
    JSON.stringify({ username, password }),
    JSON_HDRS,
  );
}

/** One-time bootstrap: first-boot setup session -> admin account -> point
 * the portal at the mock controller. Idempotent across reruns on a warm
 * stack (the personal-account login succeeds and skips the bootstrap). */
export function setup() {
  if (REMOTE) {
    // A real system: never create accounts or rewrite its UniFi settings.
    console.log(`remote target ${BASE}: skipping bootstrap (portal must already be configured)`);
    return;
  }
  let res = adminLogin(ADMIN_USER, ADMIN_PASS);
  if (res.status !== 200) {
    const boot = adminLogin("", BOOTSTRAP_PW);
    if (boot.status !== 200) {
      fail(`setup login failed (${boot.status}): ${boot.body}`);
    }
    const acc = http.post(
      `${BASE}/api/admin/accounts`,
      JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS, role: "admin" }),
      JSON_HDRS,
    );
    if (acc.status >= 400) fail(`account create failed (${acc.status}): ${acc.body}`);
    res = adminLogin(ADMIN_USER, ADMIN_PASS);
    if (res.status !== 200) fail(`admin login failed (${res.status}): ${res.body}`);
  }
  const save = http.post(
    `${BASE}/api/admin/settings`,
    JSON.stringify({
      unifiUrl: MOCK_URL,
      unifiUsername: "portal-api",
      unifiPassword: "mock-password",
      unifiSite: "default",
    }),
    JSON_HDRS,
  );
  if (save.status !== 200) fail(`settings save failed (${save.status}): ${save.body}`);
}

// Distinct identity space per load generator. Each k6 instance numbers its
// iterations from 0, so two boxes would otherwise mint the SAME phones and
// MACs and collide on the target (device cap, MAC ownership transfer). SHARD
// offsets this box's identities into its own million-wide band; give each
// box a different SHARD (0, 1, 2, …) for a distributed run.
const SHARD = Number(__ENV.SHARD || 0);
const SHARD_STRIDE = 1_000_000;

/** Globally unique guest identity per iteration. Phone is the identity
 * anchor (device cap is per phone), the MAC is what gets authorized. */
function guestIdentity() {
  const n = exec.scenario.iterationInTest + SHARD * SHARD_STRIDE;
  const phone = `55${String(n % 100000000).padStart(8, "0")}`;
  const hex = (n % 0x100000000).toString(16).padStart(8, "0");
  const mac = `aa:bb:${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}:${hex.slice(6, 8)}`;
  return { n, phone, mac };
}

function register(identity) {
  const res = http.post(
    `${BASE}/api/portal/authorize`,
    JSON.stringify({
      firstName: "Load",
      lastName: `Guest${identity.n}`,
      phone: identity.phone,
      acceptTerms: true,
      mac: identity.mac,
      apMac: "cc:dd:ee:00:00:01",
      ssid: "LoadTest",
      site: SITE,
    }),
    { ...JSON_HDRS, tags: { endpoint: "authorize" } },
  );
  check(res, {
    "authorize 200": (r) => r.status === 200,
    "access granted": (r) => {
      try {
        return JSON.parse(r.body).ok === true;
      } catch {
        return false;
      }
    },
  });
}

function burstGuest() {
  register(guestIdentity());
  const think = Number(__ENV.THINK || 0);
  if (think > 0) sleep(think);
}

/** A whole guest: captive redirect lands on the portal page, they read and
 * fill the form for a few seconds, then submit. */
function eventGuest() {
  const identity = guestIdentity();
  const page = http.get(
    `${BASE}/guest/s/${SITE}/?id=${encodeURIComponent(identity.mac)}`,
    { tags: { endpoint: "portal_page" } },
  );
  check(page, { "portal page 200": (r) => r.status === 200 });
  sleep(1 + Math.random() * 3);
  register(identity);
}

export default function () {
  if (MODE === "event") eventGuest();
  else burstGuest();
}
