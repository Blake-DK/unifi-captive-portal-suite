-- Critical-client watchlist (Phase 16 #11, Catalyst's client-tracking idea):
-- mark a client MAC and the alert monitor opens a watched_client alert while
-- it is connected — notification on connect via the normal alert channels.
CREATE TABLE "WatchedClient" (
    "mac" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "WatchedClient_pkey" PRIMARY KEY ("mac")
);
