-- Devices blocked from the network (UniFi cmd/stamgr block-sta), with the
-- admin who blocked it, when, and why (UniFi itself tracks none of that).
CREATE TABLE "BlockedDevice" (
    "mac" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "blockedBy" TEXT NOT NULL,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedDevice_pkey" PRIMARY KEY ("mac")
);
