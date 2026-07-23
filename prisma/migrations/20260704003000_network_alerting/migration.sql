-- Network alerting: background poller opens/resolves alerts + notifies.
ALTER TABLE "SystemSettings" ADD COLUMN "alertsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "alertPollSec" INTEGER NOT NULL DEFAULT 120;
ALTER TABLE "SystemSettings" ADD COLUMN "alertEmail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "alertWebhookUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "alertOfflineEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SystemSettings" ADD COLUMN "alertCpuPct" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "SystemSettings" ADD COLUMN "alertMemPct" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "SystemSettings" ADD COLUMN "alertFirmwareEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "alertSubsystemEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "Alert" (
    "id" SERIAL NOT NULL,
    "target" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "value" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "notifiedFiring" BOOLEAN NOT NULL DEFAULT false,
    "notifiedResolved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Alert_resolvedAt_idx" ON "Alert"("resolvedAt");
CREATE INDEX "Alert_target_type_idx" ON "Alert"("target", "type");
CREATE INDEX "Alert_firstSeenAt_idx" ON "Alert"("firstSeenAt");
