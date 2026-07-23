-- Controller config history (Phase 16 #4): hourly poll of the controller's
-- config collections; a new version is stored only when the canonical bundle
-- hash changes (Auvik's change-driven model). Diff and download only — the
-- portal never pushes configuration back.
ALTER TABLE "SystemSettings" ADD COLUMN "configWatchEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ConfigSnapshot" (
    "id" SERIAL NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hash" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "summary" JSONB,

    CONSTRAINT "ConfigSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConfigSnapshot_takenAt_idx" ON "ConfigSnapshot"("takenAt");
