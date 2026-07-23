-- Microsoft 365 (Graph sendMail) as an outbound mail provider + the EmailLog
-- send-activity table (docs/M365-EMAIL.md).
ALTER TABLE "SystemSettings" ADD COLUMN "emailProvider" TEXT NOT NULL DEFAULT 'smtp';
ALTER TABLE "SystemSettings" ADD COLUMN "m365TenantId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "m365ClientId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "m365ClientSecret" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "m365Sender" TEXT NOT NULL DEFAULT '';

CREATE TABLE "EmailLog" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailLog_createdAt_idx" ON "EmailLog"("createdAt");
