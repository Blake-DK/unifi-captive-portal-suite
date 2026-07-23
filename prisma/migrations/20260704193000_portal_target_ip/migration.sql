-- The Pangolin proxy target needs the portal's LAN IP: the Captive Portal
-- URL's hostname can resolve to the public (VPS) address, which would loop
-- the tunnel back through Pangolin itself.
ALTER TABLE "SystemSettings" ADD COLUMN "portalTargetIp" TEXT NOT NULL DEFAULT '';
