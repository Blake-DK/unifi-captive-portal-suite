-- Load-test control plane. The portal can drive the k6 registration-burst
-- harness on one or more remote generator boxes over SSH (a dedicated
-- app-generated keypair per box, added to that box's authorized_keys), and
-- clean up the fake guest authorizations afterwards through its own UniFi
-- session. Secrets (private key, optional sudo password) are AES-256-GCM
-- encrypted at rest like every other secret column.

CREATE TABLE "LoadTestHost" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "username" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL DEFAULT '',
    "privateKey" TEXT NOT NULL DEFAULT '',
    "sudoPassword" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoadTestHost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoadTestHost_createdAt_idx" ON "LoadTestHost"("createdAt");

CREATE TABLE "LoadTestRun" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'running',
    "mode" TEXT NOT NULL DEFAULT 'event',
    "guests" INTEGER NOT NULL DEFAULT 0,
    "windowSec" INTEGER NOT NULL DEFAULT 0,
    "target" TEXT NOT NULL DEFAULT '',
    "hostIds" JSONB NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "summary" JSONB,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "LoadTestRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoadTestRun_createdAt_idx" ON "LoadTestRun"("createdAt");
