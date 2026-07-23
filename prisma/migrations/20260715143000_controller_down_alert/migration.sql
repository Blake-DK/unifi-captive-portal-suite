-- Controller-outage watchdog: every alert rule reads the controller snapshot,
-- so an unreachable controller used to mean silence, not an alert. The poller
-- now counts consecutive failed cycles and opens a controller_down alert at
-- the threshold (email/webhook delivery does not depend on the controller);
-- the first healthy cycle resolves it through the normal diff.
ALTER TABLE "SystemSettings" ADD COLUMN "alertControllerDownEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SystemSettings" ADD COLUMN "alertControllerDownCycles" INTEGER NOT NULL DEFAULT 3;
