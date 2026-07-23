-- Free-text building entry per location: when on, guests type the building
-- themselves (required); any configured building lines become suggestions.
ALTER TABLE "Location" ADD COLUMN "buildingFreeText" BOOLEAN NOT NULL DEFAULT false;
