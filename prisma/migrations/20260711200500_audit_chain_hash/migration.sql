-- Hash-chained audit log: each new row stores
-- SHA-256(previous row's chainHash + canonical serialization of this row),
-- so silent edits or deletions of past rows break the chain and a verify
-- pass can point at the first broken link. Nullable: rows written before
-- this feature have no hash and are reported as unverifiable, never as
-- tampered.
ALTER TABLE "AuditLog" ADD COLUMN "chainHash" TEXT;
