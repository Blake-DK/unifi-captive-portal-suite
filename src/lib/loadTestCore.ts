/**
 * Pure helpers for the load-test control plane: remote-command builders and k6
 * summary parsing. Kept free of prisma/ssh2/unifi imports (and of any sibling
 * value imports) so they unit-test in isolation under the type-stripping test
 * runner — see loadTest.ts for the SSH + controller side effects.
 */

/**
 * The k6 registration-burst script, embedded as a string because the app image
 * deliberately excludes test/ (so test/load/registration-burst.js is not in the
 * container). This is the REMOTE-only variant of that harness: TARGET is always
 * set, there is no bootstrap, and handleSummary writes the metrics JSON to the
 * bind-mounted SUMMARY_PATH so the portal can read the result back over SSH.
 *
 * Keep the guest identity scheme in sync with test/load/registration-burst.js
 * AND with isFakeLoadMac() below: firstName "Load", phones 55xxxxxxxx, MACs
 * aa:bb:xx:xx:xx:xx derived from (iteration + SHARD*1_000_000). The cleanup path
 * revokes exactly those MACs, so the prefix must not drift.
 *
 * Authored with plain string concatenation (no template literals) so it can be
 * embedded in the outer template literal below without escaping.
 */
export const K6_SCRIPT = `
import http from "k6/http";
import { check, sleep } from "k6";
import exec from "k6/execution";

const TARGET = __ENV.TARGET || "";
const BASE = TARGET;
const SITE = __ENV.SITE || "default";
const MODE = (__ENV.MODE || "event").toLowerCase();
const VUS = Number(__ENV.VUS || 150);
const GUESTS = Number(__ENV.GUESTS || 3000);

function durationSeconds(raw) {
  const m = String(raw).trim().match(/^(\\d+(?:\\.\\d+)?)(s|m|h)?$/);
  if (!m) throw new Error("bad duration: " + raw);
  const unit = m[2] || "s";
  const mult = unit === "h" ? 3600 : unit === "m" ? 60 : 1;
  return Number(m[1]) * mult;
}

const WINDOW_S = durationSeconds(__ENV.WINDOW || "10m");
const RATE_UNIT_S = 10;
const PEAK_RATE = Math.max(1, Math.round((4 * GUESTS * RATE_UNIT_S) / (3 * WINDOW_S)));
const PEAK_PER_S = PEAK_RATE / RATE_UNIT_S;

const scenarios =
  MODE === "event"
    ? {
        event: {
          executor: "ramping-arrival-rate",
          startRate: 0,
          timeUnit: RATE_UNIT_S + "s",
          preAllocatedVUs: Math.min(500, Math.ceil(PEAK_PER_S * 8) + 10),
          maxVUs: Math.min(1000, Math.ceil(PEAK_PER_S * 20) + 20),
          stages: [
            { duration: Math.round(WINDOW_S * 0.2) + "s", target: PEAK_RATE },
            { duration: Math.round(WINDOW_S * 0.5) + "s", target: PEAK_RATE },
            { duration: Math.round(WINDOW_S * 0.3) + "s", target: 0 },
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
  scenarios: scenarios,
  insecureSkipTLSVerify: __ENV.INSECURE === "1",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{endpoint:authorize}": ["p(95)<" + Number(__ENV.P95_MS || 2000)],
  },
};

const SHARD = Number(__ENV.SHARD || 0);
const SHARD_STRIDE = 1000000;

function guestIdentity() {
  const n = exec.scenario.iterationInTest + SHARD * SHARD_STRIDE;
  const phone = "55" + String(n % 100000000).padStart(8, "0");
  const hex = (n % 0x100000000).toString(16).padStart(8, "0");
  const mac = "aa:bb:" + hex.slice(0, 2) + ":" + hex.slice(2, 4) + ":" + hex.slice(4, 6) + ":" + hex.slice(6, 8);
  return { n: n, phone: phone, mac: mac };
}

function register(identity) {
  const res = http.post(
    BASE + "/api/portal/authorize",
    JSON.stringify({
      firstName: "Load",
      lastName: "Guest" + identity.n,
      phone: identity.phone,
      acceptTerms: true,
      mac: identity.mac,
      apMac: "cc:dd:ee:00:00:01",
      ssid: "LoadTest",
      site: SITE,
    }),
    { headers: { "Content-Type": "application/json" }, tags: { endpoint: "authorize" } },
  );
  check(res, {
    "authorize 200": function (r) {
      return r.status === 200;
    },
    "access granted": function (r) {
      try {
        return JSON.parse(r.body).ok === true;
      } catch (e) {
        return false;
      }
    },
  });
}

function eventGuest() {
  const identity = guestIdentity();
  const page = http.get(BASE + "/guest/s/" + SITE + "/?id=" + encodeURIComponent(identity.mac), {
    tags: { endpoint: "portal_page" },
  });
  check(page, {
    "portal page 200": function (r) {
      return r.status === 200;
    },
  });
  sleep(1 + Math.random() * 3);
  register(identity);
}

function burstGuest() {
  register(guestIdentity());
  const think = Number(__ENV.THINK || 0);
  if (think > 0) sleep(think);
}

export default function () {
  if (MODE === "event") eventGuest();
  else burstGuest();
}

export function handleSummary(data) {
  const out = {};
  out[__ENV.SUMMARY_PATH || "/out/summary.json"] = JSON.stringify(data);
  out["stdout"] = "load-test complete\\n";
  return out;
}
`;

export const K6_IMAGE = "grafana/k6:0.57.0";
export const REMOTE_DIR = "/tmp/portal-loadtest";
/** MACs the harness authorizes all live under this prefix (see loadTestScript). */
export const FAKE_MAC_PREFIX = "aa:bb:";

export type RunParams = {
  target: string;
  mode: "event" | "burst";
  guests: number;
  window: string; // "10m"
  vus: number;
  ramp: string;
  hold: string;
  think: number;
  site: string;
  insecure: boolean;
  p95Ms: number;
};

/** "90", "90s", "10m", "1h" -> seconds (0 on garbage). */
export function parseWindowSeconds(raw: string): number {
  const m = /^(\d+(?:\.\d+)?)(s|m|h)?$/.exec(String(raw).trim());
  if (!m) return 0;
  const mult = m[2] === "h" ? 3600 : m[2] === "m" ? 60 : 1;
  return Math.round(Number(m[1]) * mult);
}

/** True for the fake MACs the load harness authorizes; safe to revoke. */
export function isFakeLoadMac(mac: string): boolean {
  return typeof mac === "string" && mac.toLowerCase().startsWith(FAKE_MAC_PREFIX);
}

/** POSIX single-quote a value for safe interpolation into a remote sh command. */
export function sq(v: string): string {
  return "'" + String(v).replace(/'/g, "'\\''") + "'";
}

export function containerName(runId: number, shard: number): string {
  return `portal-loadtest-${runId}-s${shard}`;
}

function scriptBase(runId: number, shard: number): string {
  return `script-${runId}-s${shard}.js`;
}
function summaryBase(runId: number, shard: number): string {
  return `summary-${runId}-s${shard}.json`;
}

// The SSH user must be able to run Docker without sudo (docker-group membership;
// the UI shows a one-line `usermod -aG docker` command). The portal never holds
// a sudo password for a box.
const DOCKER = "docker";

/**
 * The remote sh command that drops the k6 script and launches it as a detached
 * container. `docker run -d` returns the container id immediately (after any
 * image pull), so this call is short even though the run lasts minutes.
 */
export function buildLaunchScript(runId: number, shard: number, params: RunParams): string {
  const name = containerName(runId, shard);
  const scriptFile = scriptBase(runId, shard);
  const summaryFile = summaryBase(runId, shard);
  const docker = DOCKER;
  const scriptB64 = Buffer.from(K6_SCRIPT, "utf8").toString("base64");

  const env: Record<string, string> = {
    TARGET: params.target,
    MODE: params.mode,
    GUESTS: String(params.guests),
    WINDOW: params.window,
    VUS: String(params.vus),
    RAMP: params.ramp,
    HOLD: params.hold,
    THINK: String(params.think),
    SHARD: String(shard),
    SITE: params.site,
    INSECURE: params.insecure ? "1" : "",
    P95_MS: String(params.p95Ms),
    SUMMARY_PATH: `/out/${summaryFile}`,
  };
  const envFlags = Object.entries(env)
    .map(([k, v]) => `-e ${k}=${sq(v)}`)
    .join(" ");

  return [
    "set -e",
    `D=${sq(REMOTE_DIR)}`,
    'mkdir -p "$D"',
    `printf %s ${sq(scriptB64)} | base64 -d > "$D/${scriptFile}"`,
    `rm -f "$D/${summaryFile}"`,
    `${docker} rm -f ${sq(name)} >/dev/null 2>&1 || true`,
    `${docker} run -d --name ${sq(name)} -v "$D":/out ${envFlags} ${sq(K6_IMAGE)} run /out/${scriptFile}`,
  ].join("\n");
}

/** Remote sh command that reports one shard's container state + summary. */
export function buildStatusScript(runId: number, shard: number): string {
  const name = containerName(runId, shard);
  const summaryFile = summaryBase(runId, shard);
  const docker = DOCKER;
  return [
    `D=${sq(REMOTE_DIR)}`,
    `STATE=$(${docker} inspect -f '{{.State.Status}}:{{.State.ExitCode}}' ${sq(name)} 2>/dev/null || echo 'gone:')`,
    'echo "STATE=$STATE"',
    "echo SUMMARY_BEGIN",
    `cat "$D/${summaryFile}" 2>/dev/null || true`,
    "echo SUMMARY_END",
  ].join("\n");
}

/** Remote sh command that force-removes one shard's container (stop/cleanup). */
export function buildStopScript(runId: number, shard: number): string {
  return `${DOCKER} rm -f ${sq(containerName(runId, shard))} >/dev/null 2>&1 || true`;
}

export type ShardStatus = {
  shard: number;
  hostId: number;
  state: "running" | "done" | "error" | "gone";
  exitCode: number | null;
  summary: RunSummary | null;
};

export type RunSummary = {
  iterations: number;
  reqs: number;
  reqsPerSec: number;
  authorizeP95Ms: number | null;
  overallP95Ms: number | null;
  failedRate: number; // 0..1
  checksRate: number; // 0..1 (fraction passing)
};

type K6Metric = { values?: Record<string, number> };
type K6Data = { metrics?: Record<string, K6Metric> };

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Reduce a k6 handleSummary payload to the few numbers the UI shows. */
export function parseK6Summary(data: K6Data | null | undefined): RunSummary | null {
  if (!data || typeof data !== "object" || !data.metrics) return null;
  const m = data.metrics;
  const val = (name: string, key: string): number | null => num(m[name]?.values?.[key]);
  return {
    iterations: val("iterations", "count") ?? 0,
    reqs: val("http_reqs", "count") ?? 0,
    reqsPerSec: val("http_reqs", "rate") ?? 0,
    authorizeP95Ms: val("http_req_duration{endpoint:authorize}", "p(95)"),
    overallP95Ms: val("http_req_duration", "p(95)"),
    failedRate: val("http_req_failed", "rate") ?? 0,
    checksRate: val("checks", "rate") ?? 1,
  };
}

/** Combine per-shard summaries into one run-level view. */
export function aggregateSummaries(parts: (RunSummary | null)[]): RunSummary | null {
  const xs = parts.filter((p): p is RunSummary => p !== null);
  if (xs.length === 0) return null;
  const max = (get: (s: RunSummary) => number | null) =>
    xs.reduce<number | null>((acc, s) => {
      const v = get(s);
      return v === null ? acc : acc === null ? v : Math.max(acc, v);
    }, null);
  return {
    iterations: xs.reduce((a, s) => a + s.iterations, 0),
    reqs: xs.reduce((a, s) => a + s.reqs, 0),
    reqsPerSec: xs.reduce((a, s) => a + s.reqsPerSec, 0),
    authorizeP95Ms: max((s) => s.authorizeP95Ms),
    overallP95Ms: max((s) => s.overallP95Ms),
    failedRate: max((s) => s.failedRate) ?? 0,
    checksRate: xs.reduce((a, s) => Math.min(a, s.checksRate), 1),
  };
}

/** Parse the STATE / SUMMARY_BEGIN..SUMMARY_END block a status script prints. */
export function parseStatusOutput(out: string): { state: ShardStatus["state"]; exitCode: number | null; summary: RunSummary | null } {
  const stateLine = /STATE=([^\n]*)/.exec(out)?.[1]?.trim() ?? "gone:";
  const [status, code] = stateLine.split(":");
  const between = /SUMMARY_BEGIN\s*([\s\S]*?)\s*SUMMARY_END/.exec(out)?.[1]?.trim() ?? "";
  let summary: RunSummary | null = null;
  if (between) {
    try {
      summary = parseK6Summary(JSON.parse(between));
    } catch {
      summary = null;
    }
  }
  const exitCode = code === "" || code === undefined ? null : Number(code);
  let state: ShardStatus["state"];
  if (status === "running" || status === "created" || status === "restarting") state = "running";
  else if (status === "exited") state = exitCode === 0 ? "done" : "error";
  else state = "gone";
  return { state, exitCode, summary };
}
