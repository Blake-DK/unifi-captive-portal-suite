-- Site-wide ignore for adopted devices that are offline on purpose. Cleared
-- automatically when the device reports online again.
CREATE TABLE "IgnoredDevice" (
    "id" SERIAL NOT NULL,
    "mac" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IgnoredDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IgnoredDevice_mac_key" ON "IgnoredDevice"("mac");
