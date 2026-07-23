-- CreateTable
CREATE TABLE "GuestRegistration" (
    "id" SERIAL NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "cpf" TEXT,
    "macAddress" TEXT NOT NULL,
    "apMac" TEXT,
    "ssid" TEXT,
    "site" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "locationType" TEXT NOT NULL DEFAULT 'base',
    "baseLocation" TEXT,
    "building" TEXT,
    "roomNumber" TEXT,
    "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMin" INTEGER NOT NULL,
    "downKbps" INTEGER,
    "upKbps" INTEGER,
    "bytesTx" BIGINT,
    "bytesRx" BIGINT,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "GuestRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL DEFAULT 'config',
    "brandName" TEXT NOT NULL DEFAULT '501st Legion Portal',
    "logoUrl" TEXT,
    "backgroundUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#171717',
    "termsOfUse" TEXT NOT NULL DEFAULT 'By connecting to GUEST-NET you accept the terms of use and data handling policy.',
    "baseBuildings" TEXT NOT NULL DEFAULT '',
    "deployedBuildings" TEXT NOT NULL DEFAULT '',
    "welcomeText" TEXT NOT NULL DEFAULT 'Welcome to the guest network',
    "unifiUrl" TEXT NOT NULL DEFAULT '',
    "unifiUsername" TEXT NOT NULL DEFAULT '',
    "unifiPassword" TEXT NOT NULL DEFAULT '',
    "unifiSite" TEXT NOT NULL DEFAULT 'default',
    "unifiInsecureTls" BOOLEAN NOT NULL DEFAULT true,
    "guestDurationMin" INTEGER NOT NULL DEFAULT 480,
    "guestDownKbps" INTEGER NOT NULL DEFAULT 0,
    "guestUpKbps" INTEGER NOT NULL DEFAULT 0,
    "portalSuccessUrl" TEXT NOT NULL DEFAULT '',
    "adminPassword" TEXT NOT NULL DEFAULT '',
    "unifiApiType" TEXT NOT NULL DEFAULT 'auto',
    "portalBaseUrl" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuestRegistration_macAddress_idx" ON "GuestRegistration"("macAddress");

-- CreateIndex
CREATE INDEX "GuestRegistration_authorizedAt_idx" ON "GuestRegistration"("authorizedAt");
