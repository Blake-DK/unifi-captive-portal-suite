-- Metric history: sampler settings + time-series table.
ALTER TABLE "SystemSettings" ADD COLUMN "metricsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "metricSampleSec" INTEGER NOT NULL DEFAULT 300;
ALTER TABLE "SystemSettings" ADD COLUMN "metricRetentionDays" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "SystemSettings" ADD COLUMN "metricPerDevice" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "MetricSample" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scope" TEXT NOT NULL,
    "deviceMac" TEXT,
    "name" TEXT,
    "clients" INTEGER,
    "cpuPct" DOUBLE PRECISION,
    "memPct" DOUBLE PRECISION,
    "txRate" DOUBLE PRECISION,
    "rxRate" DOUBLE PRECISION,
    "wanLatency" INTEGER,
    "xputUp" DOUBLE PRECISION,
    "xputDown" DOUBLE PRECISION,
    "devicesUp" INTEGER,
    "devicesDown" INTEGER,
    "guests" INTEGER,
    CONSTRAINT "MetricSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MetricSample_scope_at_idx" ON "MetricSample"("scope", "at");
CREATE INDEX "MetricSample_deviceMac_at_idx" ON "MetricSample"("deviceMac", "at");
CREATE INDEX "MetricSample_at_idx" ON "MetricSample"("at");
