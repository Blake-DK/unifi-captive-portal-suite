-- Operator notes for WAN port-forwards (UPnP Inspector page). Keyed by a stable
-- descriptor (proto/dstPort/fwdIp/fwdPort) rather than the controller's _id,
-- which the gateway re-issues when a forward is edited.
CREATE TABLE "PortForwardNote" (
    "key" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortForwardNote_pkey" PRIMARY KEY ("key")
);
