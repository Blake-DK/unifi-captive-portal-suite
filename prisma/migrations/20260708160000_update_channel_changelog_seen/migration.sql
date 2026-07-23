-- Update-check channel: which release line the Gitea check follows —
-- "stable" (v* releases from main) or "develop" (dev-v* tags).
ALTER TABLE "SystemSettings" ADD COLUMN "updateCheckChannel" TEXT NOT NULL DEFAULT 'stable';

-- What's-new dialog bookkeeping: last app version whose changelog this admin
-- dismissed; the dialog shows once per release per admin.
ALTER TABLE "AdminUser" ADD COLUMN "lastSeenVersion" TEXT;
