-- Sponsored guest access (Phase 16 #1): a visitor's registration request is
-- emailed to a sponsor, who approves via an expiring one-use link. The
-- validated form payload is stored and replayed through the normal
-- registration path on approval. DoDI 8420.01-style host sponsorship.
ALTER TABLE "SystemSettings" ADD COLUMN "sponsorRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "sponsorEmails" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "sponsorDomains" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "sponsorDefaultMin" INTEGER NOT NULL DEFAULT 1440;
ALTER TABLE "SystemSettings" ADD COLUMN "sponsorDurationOverride" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "SponsorRequest" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedAt" TIMESTAMP(3),
    "sponsorEmail" TEXT NOT NULL,
    "grantedMin" INTEGER,
    "payload" JSONB NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "macAddress" TEXT NOT NULL,
    "registrationId" INTEGER,

    CONSTRAINT "SponsorRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SponsorRequest_tokenHash_key" ON "SponsorRequest"("tokenHash");
CREATE INDEX "SponsorRequest_status_createdAt_idx" ON "SponsorRequest"("status", "createdAt");
