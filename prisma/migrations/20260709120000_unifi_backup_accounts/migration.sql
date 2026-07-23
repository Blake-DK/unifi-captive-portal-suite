-- Backup UniFi accounts (lockout failover): up to three extra local accounts
-- the portal rotates onto ONLY while every earlier account is locked out or
-- cooling down. Passwords are encrypted at rest like unifiPassword.
ALTER TABLE "SystemSettings" ADD COLUMN "unifiUsername2" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "unifiPassword2" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "unifiUsername3" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "unifiPassword3" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "unifiUsername4" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "unifiPassword4" TEXT NOT NULL DEFAULT '';
