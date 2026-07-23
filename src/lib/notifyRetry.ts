/**
 * Bounded retry with backoff for alert notification sends. A flaky SMTP or
 * webhook endpoint gets a few attempts seconds apart; when the last one
 * fails the caller writes a dead-letter audit entry, so a dropped
 * notification is a visible event instead of a silent one.
 */

export type RetryResult = { ok: boolean; attempts: number; lastError?: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetries(
  fn: () => Promise<void>,
  opts: { attempts?: number; backoffMs?: number[]; sleeper?: (ms: number) => Promise<void> } = {},
): Promise<RetryResult> {
  // Defaults keep the worst case (~12s) well inside the alert poll interval.
  const attempts = Math.max(1, opts.attempts ?? 3);
  const backoff = opts.backoffMs ?? [2_000, 10_000];
  const wait = opts.sleeper ?? sleep;
  let lastError = "";
  for (let i = 0; i < attempts; i++) {
    try {
      await fn();
      return { ok: true, attempts: i + 1 };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (i < attempts - 1) await wait(backoff[Math.min(i, backoff.length - 1)]);
    }
  }
  return { ok: false, attempts, lastError };
}
