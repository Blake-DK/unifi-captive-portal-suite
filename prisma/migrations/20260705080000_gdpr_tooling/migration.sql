-- GDPR: guest privacy-notice content + rights-request contact.
ALTER TABLE "SystemSettings" ADD COLUMN "privacyNotice" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "privacyContact" TEXT NOT NULL DEFAULT '';
