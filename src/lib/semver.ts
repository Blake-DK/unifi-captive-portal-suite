/**
 * Minimal semver comparison for the update check — exactly what
 * semantic-release emits (MAJOR.MINOR.PATCH, optionally tagged "vX.Y.Z"),
 * nothing more. Pure and dependency-free so it unit-tests on Node's runner.
 */

/** "v1.2.3" | "1.2.3" → [1,2,3]; null when it isn't a plain semver. */
export function parseSemver(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * -1 when a < b, 0 when equal, 1 when a > b; null when either side isn't a
 * plain semver (the caller then reports "unknown" instead of guessing).
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}
