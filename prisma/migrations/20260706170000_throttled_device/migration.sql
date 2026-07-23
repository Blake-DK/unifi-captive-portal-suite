-- Clients currently rate-limited via a UniFi user group, with the admin who
-- throttled them, when, and at what rate (the controller tracks the group
-- assignment but none of this accountability).
CREATE TABLE "ThrottledDevice" (
    "mac" TEXT NOT NULL,
    "downKbps" INTEGER NOT NULL,
    "upKbps" INTEGER NOT NULL,
    "throttledBy" TEXT NOT NULL,
    "throttledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThrottledDevice_pkey" PRIMARY KEY ("mac")
);
