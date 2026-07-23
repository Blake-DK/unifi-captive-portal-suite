-- Audit-trail syslog forwarding (Phase 16 #12): every audit event goes to a
-- SIEM/collector as one RFC 5424 UDP line with a JSON payload. Best-effort by
-- design; the audit row in Postgres remains the record of truth.
ALTER TABLE "SystemSettings" ADD COLUMN "syslogEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "syslogHost" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "syslogPort" INTEGER NOT NULL DEFAULT 514;
