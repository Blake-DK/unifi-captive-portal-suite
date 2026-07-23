-- Every client MAC ever seen on the network, so a never-before-seen device can
-- be flagged (NAC-lite awareness). Populated continuously by the alert poller,
-- independent of whether the first-seen alert is enabled, so turning the alert
-- on later doesn't flag the whole existing fleet.
CREATE TABLE "SeenDevice" (
    "mac" TEXT NOT NULL,
    "hostname" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeenDevice_pkey" PRIMARY KEY ("mac")
);

-- Off-by-default alert when a MAC is seen for the first time.
ALTER TABLE "SystemSettings" ADD COLUMN "alertFirstSeenEnabled" BOOLEAN NOT NULL DEFAULT false;
