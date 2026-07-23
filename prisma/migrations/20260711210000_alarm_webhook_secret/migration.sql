-- Shared secret for the UniFi alarm webhook ingress (Phase 12): a non-empty
-- value enables POST /api/webhooks/unifi-alarm, which triggers an immediate
-- alert cycle instead of waiting for the next poll. Stored encrypted
-- (AES-256-GCM) like the other secrets.
ALTER TABLE "SystemSettings" ADD COLUMN "alarmWebhookSecret" TEXT NOT NULL DEFAULT '';
