-- Switch-port alerting thresholds (link saturation + interface error/discard ratio).
ALTER TABLE "SystemSettings" ADD COLUMN "alertSaturationPct" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SystemSettings" ADD COLUMN "alertPortErrPct" INTEGER NOT NULL DEFAULT 0;
