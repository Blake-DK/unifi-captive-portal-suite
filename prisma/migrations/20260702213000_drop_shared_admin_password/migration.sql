-- The shared admin password is gone; setup/recovery uses the ADMIN_PASSWORD env var only.
ALTER TABLE "SystemSettings" DROP COLUMN "adminPassword";
