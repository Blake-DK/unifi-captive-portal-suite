-- Per-WAN metric history: scope="wan" rows carry the interface in wanKey
-- (wan1/wan2); on scope="site" rows wanKey records which WAN was active.
ALTER TABLE "MetricSample" ADD COLUMN "wanKey" TEXT;
