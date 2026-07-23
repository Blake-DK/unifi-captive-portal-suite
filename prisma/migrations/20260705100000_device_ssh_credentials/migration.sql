-- Multiple device SSH credentials (tried in order until one authenticates).
CREATE TABLE "DeviceSshCredential" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceSshCredential_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeviceSshCredential_sortOrder_idx" ON "DeviceSshCredential"("sortOrder");

-- Carry the existing single credential over so nothing breaks on upgrade.
INSERT INTO "DeviceSshCredential" ("label", "username", "password", "port", "sortOrder")
SELECT 'Default', "deviceSshUsername", "deviceSshPassword", "deviceSshPort", 0
FROM "SystemSettings"
WHERE "id" = 'config' AND "deviceSshUsername" <> '' AND "deviceSshPassword" <> '';

-- The table is now the single source of truth; blank the legacy columns so a
-- later "delete all credentials" doesn't silently fall back to the old one.
UPDATE "SystemSettings" SET "deviceSshUsername" = '', "deviceSshPassword" = '' WHERE "id" = 'config';
