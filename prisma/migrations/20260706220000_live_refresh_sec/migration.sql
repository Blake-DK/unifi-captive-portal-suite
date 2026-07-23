-- Admin live-view refresh interval (seconds): how often the dashboard tiles
-- and alerts list re-fetch data in the browser (not a page reload).
ALTER TABLE "SystemSettings" ADD COLUMN "liveRefreshSec" INTEGER NOT NULL DEFAULT 15;
