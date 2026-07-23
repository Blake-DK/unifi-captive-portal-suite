-- Device SSH credentials for the debugging tools (diagnostics / raw command /
-- terminal). These are the controller-pushed device SSH creds; the password is
-- a blank-keeps secret, never returned to the browser.
ALTER TABLE "SystemSettings" ADD COLUMN "deviceSshUsername" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "deviceSshPassword" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "deviceSshPort" INTEGER NOT NULL DEFAULT 22;
