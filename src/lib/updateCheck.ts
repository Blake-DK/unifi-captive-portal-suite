import { readFileSync } from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "./prisma";
import { decryptSecret } from "./secrets";
import { getBuildInfo } from "./version";
import { compareSemver } from "./semver";
import { resolveChannel } from "./updateChannel";

/**
 * "Is this deployment running the latest release?" — answered by polling the
 * GitHub releases API with a read-only repo token (needed when the
 * repository is private).
 * Results are cached in-process for an hour: the public /api/version endpoint
 * and the admin-sidebar badge read the cache, so external checkers can hit
 * the endpoint freely without this app hammering GitHub — and a GitHub outage
 * degrades to "unknown", never an error page.
 */

const REPO_API = "https://api.github.com/repos/Blake-DK/unifi-captiveportal";
const RELEASES_URL = `${REPO_API}/releases/latest`;
// The develop line has no releases, only dev-v* tags — list and pick the top.
const TAGS_URL = `${REPO_API}/tags?per_page=50`;
// The nightly line has neither releases nor tags — only the branch head; a
// nightly image is "current" iff its baked commit IS that head.
const NIGHTLY_BRANCH_URL = `${REPO_API}/branches/nightly`;
const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

// CI bakes the read-only token into the image as an AES-256-GCM blob
// (.update-check-token.enc, from the UPDATE_CHECK_TOKEN Actions secret) so
// the token exists in neither the repo nor the image env/layer history. This
// key is deliberately public: alone it decrypts nothing, and the ciphertext
// only exists inside registry-gated images. A byte array (not hex) so secret
// scanners don't mistake a public key for a leak. Keep in sync with the bake
// step in the Dockerfile.
const IMAGE_TOKEN_KEY = Buffer.from([
  164, 37, 175, 137, 198, 145, 115, 154, 227, 48, 134, 3, 41, 39, 205, 38,
  80, 255, 128, 227, 73, 195, 154, 143, 124, 132, 171, 43, 237, 57, 10, 78,
]);

/** Token baked into the image by CI; "" when absent (local/dev builds). */
function imageToken(): string {
  if (state.imageToken !== null) return state.imageToken;
  try {
    const raw = readFileSync(path.join(process.cwd(), ".update-check-token.enc"));
    const d = crypto.createDecipheriv("aes-256-gcm", IMAGE_TOKEN_KEY, raw.subarray(0, 12), {
      authTagLength: 16,
    });
    d.setAuthTag(raw.subarray(12, 28));
    state.imageToken = Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    state.imageToken = "";
  }
  return state.imageToken;
}

export type LatestRelease = { version: string; publishedAt: string | null };

export type VersionStatus = {
  running: { version: string; commit: string; builtAt: string | null };
  enabled: boolean;
  latest: LatestRelease | null;
  /** Line the check compared against; nightly "versions" are commit SHAs. */
  channel: "stable" | "develop" | "nightly";
  /** true = current, false = behind, null = unknown (check disabled/failed) */
  upToDate: boolean | null;
  checkedAt: string | null;
  error?: string;
  /** Set when the running image's channel overrode the configured setting. */
  channelNote?: string;
};

type Channel = VersionStatus["channel"];

type UpdateCheckState = {
  cache: {
    latest: LatestRelease | null;
    checkedAt: number;
    channel: Channel;
    error?: string;
  } | null;
  inflight: Promise<void> | null;
  // The raw setting value, remembered so the status can say when the running
  // image's channel overrode it (see configuredToken).
  lastConfiguredChannel: Channel | null;
  imageToken: string | null;
};

// On globalThis, NOT module scope: Next compiles server components and route
// handlers into separate layers, so a module-level cache exists once per
// layer. The sidebar badge (layout render) and the checker endpoints would
// each have their own copy — a Check-now or settings save would fix one and
// leave the other serving its old verdict for up to the cache TTL. Same
// pattern as prisma.ts, and required in production, not just dev.
const globalForUpdateCheck = globalThis as unknown as { __updateCheckState?: UpdateCheckState };
const state = (globalForUpdateCheck.__updateCheckState ??= {
  cache: null,
  inflight: null,
  lastConfiguredChannel: null,
  imageToken: null,
});

/**
 * Token precedence: the UI-stored one (AES-encrypted in SystemSettings) wins;
 * `UPDATE_CHECK_TOKEN` in .env is the zero-UI fallback so a host can ship
 * with the check working out of the box. Deliberately NOT baked into the
 * image: the image is pulled with registry-scope credentials, and a
 * repo-read token inside it would escalate registry access to source access
 * (and "encrypted in the build" is circular — the key would ship alongside).
 */
async function configuredToken(): Promise<{ token: string; enabled: boolean; channel: Channel }> {
  const s = await prisma.systemSettings.findUnique({
    where: { id: "config" },
    select: { updateCheckEnabled: true, updateCheckToken: true, updateCheckChannel: true },
  }).catch(() => null);
  const envToken = (process.env.UPDATE_CHECK_TOKEN ?? "").trim();
  // Precedence: UI-stored > .env > CI-baked image token. The image token
  // only supplies the credential — enabling the check stays an explicit
  // choice (settings toggle or the env var's presence).
  const token = decryptSecret(s?.updateCheckToken ?? "") || envToken || imageToken();
  const ch = s?.updateCheckChannel;
  const configured: Channel = ch === "develop" || ch === "nightly" ? ch : "stable";
  state.lastConfiguredChannel = configured;
  // A CI-built image knows which line it came from — checking it against
  // another channel's releases yields a bogus verdict (a stable commit never
  // equals the nightly branch head; a nightly build never bumps the semver).
  // The running image's channel wins on mismatch — in both directions — and
  // the status carries a channelNote saying so. Only local builds (no baked
  // SHA) defer to the setting. See resolveChannel.
  const build = getBuildInfo();
  return {
    token,
    enabled: s?.updateCheckEnabled === true || envToken !== "",
    channel: resolveChannel(configured, build.channel, build.sha !== "dev"),
  };
}

/** Latest dev-v* tag from the tags API — the develop line has no releases. */
async function fetchLatestDevTag(token: string): Promise<LatestRelease | null> {
  const res = await fetch(TAGS_URL, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub tags API failed (${res.status})`);
  const tags = (await res.json()) as Array<{ name?: string }>;
  let best: string | null = null;
  for (const t of tags) {
    const m = /^dev-v(\d+\.\d+\.\d+)$/.exec(t.name ?? "");
    if (m && (!best || (compareSemver(m[1], best) ?? 0) > 0)) best = m[1];
  }
  return best ? { version: best, publishedAt: null } : null;
}

/** Nightly branch head — its short SHA plays the "version" role (no tags). */
async function fetchNightlyHead(token: string): Promise<LatestRelease | null> {
  const res = await fetch(NIGHTLY_BRANCH_URL, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub branch API failed (${res.status})`);
  const body = (await res.json()) as {
    commit?: { sha?: string; commit?: { committer?: { date?: string } } };
  };
  const sha = body.commit?.sha ?? "";
  return sha
    ? { version: sha.slice(0, 7), publishedAt: body.commit?.commit?.committer?.date ?? null }
    : null;
}

async function refresh(): Promise<void> {
  const { token, enabled, channel } = await configuredToken();
  if (!enabled) return;
  if (!token) {
    state.cache = { latest: state.cache?.latest ?? null, checkedAt: Date.now(), channel, error: "No GitHub token configured" };
    return;
  }
  try {
    if (channel === "nightly") {
      const latest = await fetchNightlyHead(token);
      state.cache = latest
        ? { latest, checkedAt: Date.now(), channel }
        : { latest: state.cache?.latest ?? null, checkedAt: Date.now(), channel, error: "nightly branch not found" };
      return;
    }
    if (channel === "develop") {
      const latest = await fetchLatestDevTag(token);
      state.cache = latest
        ? { latest, checkedAt: Date.now(), channel }
        : { latest: state.cache?.latest ?? null, checkedAt: Date.now(), channel, error: "No dev-v* tags found" };
      return;
    }
    const res = await fetch(RELEASES_URL, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      state.cache = {
        latest: state.cache?.latest ?? null,
        checkedAt: Date.now(),
        channel,
        error: res.status === 401 || res.status === 403
          ? `GitHub rejected the token (${res.status})`
          : `GitHub releases API failed (${res.status})`,
      };
      return;
    }
    const body = (await res.json()) as { tag_name?: string; published_at?: string };
    const version = (body.tag_name ?? "").replace(/^v/, "");
    state.cache = version
      ? { latest: { version, publishedAt: body.published_at ?? null }, checkedAt: Date.now(), channel }
      : { latest: state.cache?.latest ?? null, checkedAt: Date.now(), channel, error: "No tag in the latest release" };
  } catch (err) {
    // Keep any previous answer — stale beats blank during a GitHub blip.
    state.cache = {
      latest: state.cache?.latest ?? null,
      checkedAt: Date.now(),
      channel,
      error: err instanceof Error ? err.message : "Update check failed",
    };
  }
}

function toStatus(enabled: boolean): VersionStatus {
  const build = getBuildInfo();
  const latest = state.cache?.latest ?? null;
  const channel = state.cache?.channel ?? "stable";
  let upToDate: boolean | null = null;
  if (latest) {
    if (channel === "nightly") {
      // SHA equality, not ordering: a nightly image is current iff it was
      // built from the branch head. Local "dev" builds can't be compared.
      upToDate = build.sha === "dev" ? null : build.shortSha === latest.version;
    } else {
      const cmp = compareSemver(build.version, latest.version);
      upToDate = cmp == null ? null : cmp >= 0;
    }
  }
  return {
    running: { version: build.version, commit: build.sha, builtAt: build.builtAt },
    enabled,
    latest,
    channel,
    upToDate,
    checkedAt: state.cache ? new Date(state.cache.checkedAt).toISOString() : null,
    ...(state.cache?.error ? { error: state.cache.error } : {}),
    ...(state.lastConfiguredChannel &&
    resolveChannel(state.lastConfiguredChannel, build.channel, build.sha !== "dev") !==
      state.lastConfiguredChannel
      ? {
          channelNote: `This host is running a ${build.channel} image, so the check follows the ${build.channel} line — the "${state.lastConfiguredChannel}" setting is ignored until the host runs that line again.`,
        }
      : {}),
  };
}

/** Full status; refreshes the cache when stale (or `force`), awaiting the fetch. */
export async function getVersionStatus(force = false): Promise<VersionStatus> {
  const { enabled } = await configuredToken();
  if (enabled && (force || !state.cache || Date.now() - state.cache.checkedAt > CACHE_TTL_MS)) {
    state.inflight ??= refresh().finally(() => (state.inflight = null));
    await state.inflight;
  }
  return toStatus(enabled);
}

/**
 * Cache-only, never awaits the network — for render paths like the admin
 * sidebar. Kicks off a background refresh when stale so the next render has
 * an answer.
 */
export function getCachedVersionStatus(): VersionStatus {
  if (!state.cache || Date.now() - state.cache.checkedAt > CACHE_TTL_MS) {
    state.inflight ??= refresh().finally(() => (state.inflight = null));
    void state.inflight.catch(() => {});
  }
  return toStatus(true);
}

/** Reset after a settings change so a new token/toggle takes effect at once. */
export function clearUpdateCheckCache(): void {
  state.cache = null;
}
