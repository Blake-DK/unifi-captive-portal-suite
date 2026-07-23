-- v2: portal-managed Traefik replaces the Pangolin integration.
-- The portal now renders Traefik's config itself (dynamic via
-- GET /api/traefik/config, static into the shared ./traefik mount), so the
-- Pangolin API client settings go away. Secrets (cfDnsApiToken,
-- traefikConfigToken) are encrypted at rest (src/lib/secrets.ts).
ALTER TABLE "SystemSettings" DROP COLUMN "pangolinUrl";
ALTER TABLE "SystemSettings" DROP COLUMN "pangolinOrgId";
ALTER TABLE "SystemSettings" DROP COLUMN "pangolinApiKey";
ALTER TABLE "SystemSettings" ADD COLUMN "reverseProxyMode" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "SystemSettings" ADD COLUMN "acmeEmail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "cfDnsApiToken" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "traefikConfigToken" TEXT NOT NULL DEFAULT '';

-- Extra hostnames served through the bundled/external Traefik.
CREATE TABLE "ProxyResource" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "tls" BOOLEAN NOT NULL DEFAULT true,
    "blockAdminPaths" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProxyResource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProxyResource_sortOrder_idx" ON "ProxyResource"("sortOrder");
