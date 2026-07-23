-- Rogue UniFi devices tab: operator decisions about un-onboarded UniFi
-- hardware seen as a client. Detected rows need no entry; rows exist for
-- manual marks and for ignores (permanent, or until the device reconnects).
CREATE TABLE "RogueUnifiDevice" (
    "id" SERIAL NOT NULL,
    "mac" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RogueUnifiDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RogueUnifiDevice_mac_key" ON "RogueUnifiDevice"("mac");
