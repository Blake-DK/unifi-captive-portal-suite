-- Guest session signing key reverts to .env-only (GUEST_SESSION_SECRET),
-- matching ADMIN_SECRET's pattern. Safe to drop: this field was never
-- customized via the GUI on the deployment that carried it.
ALTER TABLE "SystemSettings" DROP COLUMN "guestSessionSecret";
