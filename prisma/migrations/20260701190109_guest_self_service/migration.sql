-- AlterTable
ALTER TABLE "GuestRegistration" ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "maxDevicesPerPhone" INTEGER NOT NULL DEFAULT 5;

-- CreateIndex
CREATE INDEX "GuestRegistration_phone_idx" ON "GuestRegistration"("phone");

-- Normalize historical phone values to digits-only so self-service login
-- (which matches on digits) works against rows created before this feature.
UPDATE "GuestRegistration" SET phone = regexp_replace(phone, '[^0-9]', '', 'g');
