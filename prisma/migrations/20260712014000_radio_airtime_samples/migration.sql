-- Channel/airtime history (Phase 16 #7): the metric sampler records one row
-- per AP radio (scope "radio") with channel utilization and client count,
-- charted on the metrics page.
ALTER TABLE "MetricSample" ADD COLUMN "band" TEXT;
ALTER TABLE "MetricSample" ADD COLUMN "airtimePct" INTEGER;
