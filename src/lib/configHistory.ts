import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { fetchConfigCollections } from "./unifi";
import { scrubSecrets, stableJson, summarizeChanges, type ChangeSummary } from "./configDiff";
import { auditSystem } from "./audit";
import { getMailSettings, isMailConfigured, sendMail } from "./mailer";

/**
 * Controller config history: poll the config collections hourly, store a new
 * version only when the canonical hash changes (Auvik's change-driven
 * model), note WHAT changed per collection, and tell the alert email about
 * it. Versions are for eyes and diffs only — the portal never pushes
 * configuration back to the controller.
 */

const KEEP_SNAPSHOTS = 100;

export type ConfigWatchStats = {
  changed: boolean;
  baseline?: boolean;
  summary?: ChangeSummary;
  skipped?: string;
};

export async function runConfigWatchCycle(
  opts: { force?: boolean } = {},
): Promise<ConfigWatchStats> {
  const s = await prisma.systemSettings.findUnique({
    where: { id: "config" },
    select: { configWatchEnabled: true, alertEmail: true },
  });
  if (!s?.configWatchEnabled && !opts.force) return { changed: false, skipped: "disabled" };

  let bundle: Record<string, unknown>;
  try {
    // Scrub BEFORE anything is hashed or stored: x_* secret fields become
    // fingerprints, so a rotated passphrase still diffs without the
    // passphrase ever touching the snapshot store.
    bundle = scrubSecrets(await fetchConfigCollections());
  } catch {
    return { changed: false, skipped: "controller unreachable" };
  }
  if (Object.keys(bundle).length === 0) {
    return { changed: false, skipped: "no collections readable" };
  }

  const canonical = stableJson(bundle);
  const hash = createHash("sha256").update(canonical).digest("hex");

  const latest = await prisma.configSnapshot.findFirst({
    orderBy: { id: "desc" },
    select: { id: true, hash: true, data: true },
  });
  if (latest?.hash === hash) return { changed: false };

  const summary = latest
    ? summarizeChanges(latest.data as Record<string, unknown>, bundle)
    : undefined;

  await prisma.configSnapshot.create({
    data: {
      hash,
      data: bundle as never,
      summary: (summary ?? null) as never,
    },
  });
  // Change-driven retention: only versions that differ are stored, so a cap
  // this size spans a long history.
  const stale = await prisma.configSnapshot.findMany({
    orderBy: { id: "desc" },
    skip: KEEP_SNAPSHOTS,
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.configSnapshot.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
  }

  if (!latest) {
    await auditSystem({
      actorType: "system",
      actor: "config-watch",
      action: "controller.config_baseline",
      detail: { collections: Object.keys(bundle) },
    });
    return { changed: true, baseline: true };
  }

  const summaryLine = Object.entries(summary ?? {})
    .map(([k, v]) => `${k}: +${v.added} −${v.removed} ~${v.changed}`)
    .join("; ");
  await auditSystem({
    actorType: "system",
    actor: "config-watch",
    action: "controller.config_change",
    detail: { summary: summary ?? {} },
  });

  // Tell the alert channel — a config change on the controller is exactly
  // the kind of event an operator wants pushed, not discovered.
  if (s?.alertEmail) {
    const mail = await getMailSettings();
    if (isMailConfigured(mail)) {
      await sendMail(mail, {
        to: s.alertEmail!,
        subject: `${mail.brandName || "Network"}: controller configuration changed`,
        html: `<p>The UniFi controller's configuration changed:</p><p><code>${summaryLine}</code></p><p>Review the versions on the portal's Config history page.</p>`,
        text: `The UniFi controller's configuration changed:\n${summaryLine}\nReview the versions on the portal's Config history page.`,
        kind: "alert",
      }).catch((e) => console.error("Config-change mail failed:", e));
    }
  }
  return { changed: true, summary };
}

let started = false;

/** Hourly, like Auvik's default poll. */
export function startConfigWatch(): void {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      await runConfigWatchCycle();
    } catch (err) {
      console.error("Config watch cycle failed:", err);
    }
  };
  const timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref?.();
  setTimeout(tick, 120_000).unref?.();
  console.log("Config watch started (hourly).");
}
