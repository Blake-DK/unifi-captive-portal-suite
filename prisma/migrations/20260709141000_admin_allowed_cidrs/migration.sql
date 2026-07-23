-- Management-network allowlist for the admin surface (empty = unrestricted).
ALTER TABLE "SystemSettings" ADD COLUMN "adminAllowedCidrs" TEXT NOT NULL DEFAULT '';
