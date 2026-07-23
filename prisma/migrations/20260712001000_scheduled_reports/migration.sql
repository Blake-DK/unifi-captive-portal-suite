-- Scheduled summary report (Phase 16 #3): a Meraki-style email digest —
-- usage, top talkers, WAN health, PoE, guest and alert stats — sent daily,
-- weekly (Mondays) or monthly (the 1st).
ALTER TABLE "SystemSettings" ADD COLUMN "reportEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "reportFrequency" TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE "SystemSettings" ADD COLUMN "reportEmail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "reportLastSentAt" TIMESTAMP(3);
