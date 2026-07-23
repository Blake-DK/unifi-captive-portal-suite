-- Update check: whether this build is the latest release, surfaced at
-- /api/version and as an admin-sidebar badge. Polls the Gitea releases API
-- with a read-only repo token (the instance has no anonymous access).
-- Token is a secret, encrypted at rest (src/lib/secrets.ts).
ALTER TABLE "SystemSettings" ADD COLUMN "updateCheckEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "updateCheckToken" TEXT NOT NULL DEFAULT '';
