-- Optional UniFi Integration-API key (X-API-KEY header, UniFi OS 4+ /
-- Network 9+). Supplements — never replaces — the local account: the
-- Integration API only covers a read subset (sites/clients/devices), so all
-- writes and the richer monitoring reads stay on the cookie session.
-- Secret, encrypted at rest (src/lib/secrets.ts).
ALTER TABLE "SystemSettings" ADD COLUMN "unifiApiKey" TEXT NOT NULL DEFAULT '';
