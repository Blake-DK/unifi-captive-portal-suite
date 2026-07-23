-- When set, guests registering under this location must supply a room
-- number (see resolveLocationForRegistration()); mirrors the existing
-- buildings-triggers-required-building pattern.
ALTER TABLE "Location" ADD COLUMN "isHotel" BOOLEAN NOT NULL DEFAULT false;
