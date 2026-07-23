-- Session security settings, moved from .env to the GUI (Settings -> URLs).
-- Nullable with NO default on purpose: a backfilled default would silently
-- override either value for existing deployments before the one-time env
-- seed (encryptExistingSecrets()) gets a chance to run on next boot. Every
-- read site treats null as "not yet configured" (cookieSecure -> false,
-- guestSessionSecret -> derive from ADMIN_SECRET).
ALTER TABLE "SystemSettings" ADD COLUMN "cookieSecure" BOOLEAN;
ALTER TABLE "SystemSettings" ADD COLUMN "guestSessionSecret" TEXT;
