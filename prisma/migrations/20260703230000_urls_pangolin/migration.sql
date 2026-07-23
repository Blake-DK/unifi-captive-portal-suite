-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "adminBaseUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "pangolinUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "pangolinApiKey" TEXT NOT NULL DEFAULT '';
