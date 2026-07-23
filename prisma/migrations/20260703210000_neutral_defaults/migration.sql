-- Neutral fresh-install defaults: the portal is deployed on different
-- networks/domains, so nothing network-specific may be baked in. Existing
-- rows keep whatever values they have; only column defaults change.
ALTER TABLE "SystemSettings" ALTER COLUMN "brandName" SET DEFAULT 'Guest WiFi Portal';
ALTER TABLE "SystemSettings" ALTER COLUMN "termsOfUse" SET DEFAULT 'By connecting to this network you accept the terms of use and data handling policy.';
ALTER TABLE "SystemSettings" ALTER COLUMN "welcomeText" SET DEFAULT 'Welcome';
