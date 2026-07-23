-- Failed-admin-login alert thresholds, promoted from constants in
-- alertMonitor.ts to per-site settings (the code comment always said
-- "promote later"). Defaults match the old constants exactly.
ALTER TABLE "SystemSettings" ADD COLUMN "alertFailedLoginCount" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "SystemSettings" ADD COLUMN "alertFailedLoginWindowMin" INTEGER NOT NULL DEFAULT 15;
