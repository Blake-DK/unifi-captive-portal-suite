-- One-time 2FA recovery/backup codes (hashed, single-use).
CREATE TABLE "TotpRecoveryCode" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TotpRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TotpRecoveryCode_userId_idx" ON "TotpRecoveryCode"("userId");

ALTER TABLE "TotpRecoveryCode" ADD CONSTRAINT "TotpRecoveryCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
