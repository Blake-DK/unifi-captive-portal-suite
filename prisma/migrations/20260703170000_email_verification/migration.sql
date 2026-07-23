-- AlterTable
ALTER TABLE "GuestRegistration" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "emailVerifyEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "emailVerifyInitialMin" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "emailVerifyGraceMin" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "smtpHost" TEXT NOT NULL DEFAULT '',
ADD COLUMN "smtpPort" INTEGER NOT NULL DEFAULT 587,
ADD COLUMN "smtpSecurity" TEXT NOT NULL DEFAULT 'starttls',
ADD COLUMN "smtpUser" TEXT NOT NULL DEFAULT '',
ADD COLUMN "smtpPassword" TEXT NOT NULL DEFAULT '',
ADD COLUMN "smtpFromEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN "smtpFromName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "emailVerifySubject" TEXT NOT NULL DEFAULT 'Confirm your email address',
ADD COLUMN "emailVerifyHeading" TEXT NOT NULL DEFAULT 'Confirm your email',
ADD COLUMN "emailVerifyBody" TEXT NOT NULL DEFAULT 'Tap the button below to confirm your email address and unlock your full WiFi access. If you didn''t request this, you can ignore this message.',
ADD COLUMN "emailVerifyButton" TEXT NOT NULL DEFAULT 'Confirm email address';
