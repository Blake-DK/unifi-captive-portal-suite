-- Expiry notifications: warn guests by email shortly before access expires.
ALTER TABLE "SystemSettings" ADD COLUMN "expiryNotifyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "expiryNotifyLeadMin" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "GuestRegistration" ADD COLUMN "expiryNotifiedAt" TIMESTAMP(3);
