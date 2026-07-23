-- Click-through warning banner (Phase 16 #2, WLAN STIG): shown full-screen
-- before the guest registration and self-service login pages; the guest must
-- acknowledge it each browser session before the flow renders.
ALTER TABLE "SystemSettings" ADD COLUMN "warningBannerEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "warningBannerText" TEXT NOT NULL DEFAULT '';
