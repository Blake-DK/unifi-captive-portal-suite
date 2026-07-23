-- Vouchers: pre-generated codes that grant a specific access window /
-- bandwidth / quota on the portal form, bypassing email verification.
CREATE TABLE "Voucher" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "note" TEXT,
    "durationMin" INTEGER NOT NULL,
    "downKbps" INTEGER,
    "upKbps" INTEGER,
    "quotaMB" INTEGER,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Voucher_code_key" ON "Voucher"("code");
CREATE INDEX "Voucher_createdAt_idx" ON "Voucher"("createdAt");

ALTER TABLE "GuestRegistration" ADD COLUMN "voucherId" INTEGER;
ALTER TABLE "GuestRegistration" ADD CONSTRAINT "GuestRegistration_voucherId_fkey"
    FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
