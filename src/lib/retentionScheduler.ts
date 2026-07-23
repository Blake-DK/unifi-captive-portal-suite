import { auditSystem } from "./audit";
import { runRetention } from "./retention";

const FIRST_RUN_DELAY_MS = 60_000; // let boot/migrations settle first
const INTERVAL_MS = 60 * 60 * 1000;

let started = false;

/**
 * In-process hourly retention timer, started once from instrumentation.ts.
 * Single-instance deployment (one portal container) — no distributed lock.
 */
export function startRetentionScheduler(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      const stats = await runRetention();
      await auditSystem({
        actorType: "admin",
        actor: "scheduler",
        action: "retention.run",
        detail: stats,
        outcome: "success",
      });
    } catch (err) {
      console.error("Scheduled retention run failed:", err);
    }
  };

  setTimeout(tick, FIRST_RUN_DELAY_MS);
  setInterval(tick, INTERVAL_MS);
  console.log("Retention scheduler started (hourly).");
}
