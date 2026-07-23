-- Optional auto-disable date for temporary admin accounts: once the date
-- passes, login and existing sessions are rejected (adminGuard + login route)
-- until another admin clears or moves the date.
ALTER TABLE "AdminUser" ADD COLUMN "expiresAt" TIMESTAMP(3);
