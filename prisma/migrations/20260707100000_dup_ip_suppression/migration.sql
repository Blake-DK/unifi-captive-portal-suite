-- Duplicate-IP false-positive suppression (Phase 9B). Master toggle, dry-run
-- mode, per-check enables and the arping device/VLAN map on SystemSettings,
-- plus the SuppressedAlert log so a gated alarm is auditable — never silently
-- dropped.
ALTER TABLE "SystemSettings" ADD COLUMN "dupIpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "dupIpDryRun" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SystemSettings" ADD COLUMN "dupIpCheckMacRandom" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SystemSettings" ADD COLUMN "dupIpCheckSessions" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SystemSettings" ADD COLUMN "dupIpCheckDhcp" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SystemSettings" ADD COLUMN "dupIpCheckArping" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "dupIpArpingMap" TEXT NOT NULL DEFAULT '';

CREATE TABLE "SuppressedAlert" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'duplicate_ip',
    "ip" TEXT NOT NULL,
    "macA" TEXT NOT NULL DEFAULT '',
    "macB" TEXT NOT NULL DEFAULT '',
    "vlan" INTEGER,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verdict" TEXT NOT NULL DEFAULT 'suppress',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAlarmAt" TIMESTAMP(3),
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SuppressedAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SuppressedAlert_ip_macA_macB_key" ON "SuppressedAlert"("ip", "macA", "macB");

CREATE INDEX "SuppressedAlert_lastSeenAt_idx" ON "SuppressedAlert"("lastSeenAt");
