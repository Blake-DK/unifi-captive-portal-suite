-- Root domains for the proxied-resources hostname picker: the admin enters
-- base domains once (Settings -> URLs -> Domains) and new resources compose
-- their hostname from a subdomain box + base-domain dropdown.
ALTER TABLE "SystemSettings" ADD COLUMN "proxyRootDomains" TEXT NOT NULL DEFAULT '';
