-- Heuristic OUI/hostname-based detection of consumer WiFi extenders/mesh
-- nodes among connected clients. Off by default like other heuristic-prone
-- rules (see alertFirmwareEnabled) since it can false-positive.
ALTER TABLE "SystemSettings" ADD COLUMN "alertRogueExtenderEnabled" BOOLEAN NOT NULL DEFAULT false;
