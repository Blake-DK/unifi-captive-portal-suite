import pkg from "../../package.json";

/**
 * Build identity. The semantic version is the single source of truth in
 * package.json; the commit SHA + build time are baked into the image by CI
 * (Dockerfile ARG -> ENV). Locally / in dev the CI values are absent and read
 * as a "dev" build, but the version is still reported.
 */
export type BuildInfo = {
  version: string; // semantic version (MAJOR.MINOR.PATCH) from package.json
  sha: string; // full commit SHA, or "dev"
  shortSha: string;
  builtAt: string | null; // ISO timestamp of the built commit, if known
  /**
   * "develop" for integration-branch images (yellow banner), "nightly" for
   * ungated fast-iteration builds (red banner), else "stable".
   */
  channel: "stable" | "develop" | "nightly";
  /**
   * Nightly builds have no release tags, so they get a date-time build
   * number derived from the built commit's timestamp (BUILD_TIME is
   * `git log -1 --format=%cI`, so it is deterministic per commit) —
   * e.g. "3.1.0-nightly.202607081830"; short SHA when the time is unknown.
   * Null on the other channels.
   */
  nightlyVersion: string | null;
};

export function getBuildInfo(): BuildInfo {
  const sha = process.env.APP_GIT_SHA || "dev";
  const ch = process.env.APP_CHANNEL;
  const builtAt = process.env.APP_BUILD_TIME || null;
  const channel = ch === "develop" || ch === "nightly" ? ch : "stable";
  return {
    version: pkg.version,
    sha,
    shortSha: sha === "dev" ? "dev" : sha.slice(0, 7),
    builtAt,
    channel,
    nightlyVersion:
      channel === "nightly"
        ? `${pkg.version}-nightly.${builtAt ? builtAt.replace(/\D/g, "").slice(0, 12) : sha.slice(0, 7)}`
        : null,
  };
}
