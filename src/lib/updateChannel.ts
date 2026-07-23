export type UpdateChannel = "stable" | "develop" | "nightly";

/**
 * Which release line should the update check follow? The configured setting
 * is a fallback for builds that can't identify their own line. A CI-built
 * image knows its channel (develop/nightly bake APP_CHANNEL, release builds
 * bake the commit SHA), and checking one line's build against another
 * line's "latest" yields nonsense: a nightly head can never semver-match,
 * and a stable image can never equal the nightly branch head by SHA. So on
 * any mismatch the running image's channel wins. Local builds carry no
 * baked SHA and read as "stable" without actually being the stable line,
 * so only the setting can speak for them.
 */
export function resolveChannel(
  configured: UpdateChannel,
  running: UpdateChannel,
  ciImage: boolean,
): UpdateChannel {
  if (running === configured) return configured;
  if (running !== "stable") return running;
  return ciImage ? "stable" : configured;
}
