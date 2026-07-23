-- Session revocation on password change: tokens issued before this instant
-- are rejected by the admin guard.
ALTER TABLE "AdminUser" ADD COLUMN "sessionsValidFrom" TIMESTAMP(3);
