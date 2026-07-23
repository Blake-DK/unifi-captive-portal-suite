-- CreateTable
CREATE TABLE "Location" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "buildings" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "retentionMode" TEXT NOT NULL DEFAULT 'forever',
    "retentionDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_sortOrder_idx" ON "Location"("sortOrder");

-- AlterTable
ALTER TABLE "GuestRegistration" ADD COLUMN "locationId" INTEGER,
ADD COLUMN "locationName" TEXT,
ADD COLUMN "anonymizedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "GuestRegistration_locationId_idx" ON "GuestRegistration"("locationId");

-- AddForeignKey
ALTER TABLE "GuestRegistration" ADD CONSTRAINT "GuestRegistration_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "defaultRetentionMode" TEXT NOT NULL DEFAULT 'forever',
ADD COLUMN "defaultRetentionDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "auditRetentionDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastRetentionRunAt" TIMESTAMP(3),
ADD COLUMN "lastRetentionStats" JSONB;

-- Seed the two legacy location choices so upgrades keep the current portal UX.
-- Building lists are copied from the existing settings row (empty on fresh installs).
INSERT INTO "Location" ("name", "buildings", "sortOrder", "retentionMode", "retentionDays", "updatedAt")
SELECT 'On Base', COALESCE((SELECT "baseBuildings" FROM "SystemSettings" WHERE "id" = 'config'), ''), 0, 'forever', 0, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Location");

INSERT INTO "Location" ("name", "buildings", "sortOrder", "retentionMode", "retentionDays", "updatedAt")
SELECT 'Deployed', COALESCE((SELECT "deployedBuildings" FROM "SystemSettings" WHERE "id" = 'config'), ''), 1, 'forever', 0, CURRENT_TIMESTAMP
WHERE (SELECT COUNT(*) FROM "Location") < 2;
