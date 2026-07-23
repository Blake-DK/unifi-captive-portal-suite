import { Client } from "pg";

/**
 * Single-runner guard for the in-process background schedulers (retention,
 * expiry-notify, alert monitor, metric sampler). They assume exactly one
 * instance runs them — two would double-write metrics, double-send expiry
 * mail, and race the retention job. This holds a Postgres *session-level*
 * advisory lock on a dedicated, long-lived connection (Prisma's pooled
 * connections would release it the moment the query returns), so if the app
 * is ever scaled to more than one container only the lock holder runs them.
 *
 * Fail-open by design: if the lock can't be attempted (DB unreachable at boot,
 * pg error), it returns true and the schedulers run anyway — never worse than
 * the pre-guard behaviour where every instance ran. The guard only *prevents*
 * a second instance from double-running once the DB is reachable.
 */

// Stable arbitrary key so every instance contends for the same lock ("PORT").
const SCHEDULER_LOCK_KEY = 0x504f5254;

let lockClient: Client | null = null;

export async function acquireSchedulerLock(): Promise<boolean> {
  if (lockClient) return true; // already held by this process
  try {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const res = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [SCHEDULER_LOCK_KEY],
    );
    const locked = res.rows[0]?.locked === true;
    if (!locked) {
      await client.end().catch(() => {});
      return false;
    }
    lockClient = client;
    // Release cleanly on shutdown so a rolling restart's next instance can
    // re-acquire immediately (a crash also releases it — session locks drop
    // when the connection dies).
    const release = () => {
      lockClient = null;
      client.end().catch(() => {});
    };
    process.once("SIGTERM", release);
    process.once("SIGINT", release);
    return true;
  } catch (err) {
    console.warn(
      "[schedulerLock] advisory lock unavailable — running schedulers anyway:",
      err instanceof Error ? err.message : err,
    );
    return true;
  }
}
