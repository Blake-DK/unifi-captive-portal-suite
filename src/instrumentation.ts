export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Encrypt any pre-existing plaintext secrets once (idempotent).
  const { encryptExistingSecrets } = await import("./lib/encryptExistingSecrets");
  void encryptExistingSecrets();
  // Migrate COOKIE_SECURE/GUEST_SESSION_SECRET from .env into the DB once, if set.
  const { seedSessionSecurityFromEnv } = await import("./lib/seedSessionSecurityEnv");
  void seedSessionSecurityFromEnv();
  const { ownsProxyControlPlane, schedulersEnabled } = await import("./lib/portalMode");
  // Warn loudly about half-configured splits (PORTAL_MODE without the profile,
  // profile without PORTAL_MODE, an unroutable admin host, external split with
  // no upstream) — each silently bricks routing or the admin GUI otherwise.
  const { warnSplitConfig } = await import("./lib/instrumentationSplitCheck");
  void warnSplitConfig();
  // Bundled Traefik reads its static config from the shared ./traefik mount;
  // make sure it exists before traefik's restart loop gives up waiting. In a
  // split deployment the admin process owns proxy config — a guest-role
  // process never writes it (least privilege on the shared mount). A lone guest
  // (misconfig) still writes, so it can't brick its own routing.
  if (ownsProxyControlPlane()) {
    const { ensureTraefikFiles } = await import("./lib/traefikStatic");
    void ensureTraefikFiles();
  }
  // Role split: a guest-only process (PORTAL_MODE=guest), or one explicitly
  // opted out with SCHEDULERS=off, runs none of the background jobs — the admin
  // process owns them. Unset = runs them (today's single-container default).
  if (!schedulersEnabled()) {
    console.log("[instrumentation] background schedulers disabled for this role (PORTAL_MODE=guest or SCHEDULERS=off)");
    return;
  }
  // The background schedulers assume a single runner. Take a process-wide
  // advisory lock so a second container (horizontal scale) doesn't double-run
  // them; fail-open so the sole instance always runs them.
  const { acquireSchedulerLock } = await import("./lib/schedulerLock");
  if (!(await acquireSchedulerLock())) {
    console.log(
      "[instrumentation] another instance holds the scheduler lock — skipping background jobs",
    );
    return;
  }
  const { startRetentionScheduler } = await import("./lib/retentionScheduler");
  startRetentionScheduler();
  const { startExpiryNotifyScheduler } = await import("./lib/expiryNotifier");
  startExpiryNotifyScheduler();
  const { startAlertMonitor } = await import("./lib/alertMonitor");
  startAlertMonitor();
  const { startMetricSampler } = await import("./lib/metricSampler");
  startMetricSampler();
  const { startReportScheduler } = await import("./lib/summaryReport");
  startReportScheduler();
  const { startConfigWatch } = await import("./lib/configHistory");
  startConfigWatch();
}
