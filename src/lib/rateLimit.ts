import type { NextRequest } from "next/server";

/**
 * Fixed-window in-memory rate limiter. Sufficient here because the app runs
 * as a single pm2 instance (ecosystem.config.js); state resets on restart,
 * which only ever errs in the caller's favor.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

function prune(now: number): void {
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

/** Returns true if the call is allowed, false if the key is over its limit. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) prune(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= limit;
}

/** Check-only: true when the key is already at/over its limit (no increment).
 * Pairs with recordAttempt for failure-based limits, where only unsuccessful
 * tries should count (a 2FA login legitimately hits its route twice). */
export function isOverLimit(key: string, limit: number): boolean {
  const b = buckets.get(key);
  return !!b && b.resetAt > Date.now() && b.count >= limit;
}

/** Increment-only: count one (failed) attempt against the key. */
export function recordAttempt(key: string, windowMs: number): void {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) prune(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    b.count++;
  }
}

export function clientIp(req: NextRequest): string | undefined {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    undefined
  );
}
