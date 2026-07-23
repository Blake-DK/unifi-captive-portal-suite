-- Tiered plans: per-location duration/bandwidth/quota/device-cap overrides.
ALTER TABLE "Location" ADD COLUMN "durationMin" INTEGER;
ALTER TABLE "Location" ADD COLUMN "downKbps" INTEGER;
ALTER TABLE "Location" ADD COLUMN "upKbps" INTEGER;
ALTER TABLE "Location" ADD COLUMN "quotaMB" INTEGER;
ALTER TABLE "Location" ADD COLUMN "maxDevices" INTEGER;
