-- SNMPv3 fallback poller (Stage 1 of the controller-outage monitoring work):
-- while the controller is unreachable, reachability comes from polling the
-- last-known infra device list directly over SNMP instead of through it.
-- v3 authPriv only by design — no v1/v2c community-string support.
CREATE TABLE "SnmpTarget" (
    "mac" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "type" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnmpTarget_pkey" PRIMARY KEY ("mac")
);

ALTER TABLE "SystemSettings" ADD COLUMN "snmpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "snmpUser" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "snmpAuthKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "snmpPrivKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "snmpAuthProtocol" TEXT NOT NULL DEFAULT 'sha';
ALTER TABLE "SystemSettings" ADD COLUMN "snmpPrivProtocol" TEXT NOT NULL DEFAULT 'aes';
ALTER TABLE "SystemSettings" ADD COLUMN "snmpPort" INTEGER NOT NULL DEFAULT 161;
