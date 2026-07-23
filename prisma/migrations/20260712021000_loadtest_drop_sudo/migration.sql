-- Drop the stored sudo password. Generator boxes now run Docker via docker-group
-- membership (a copy-paste `usermod -aG docker <user>` command shown in the UI),
-- so the portal never holds a sudo secret for a box.
ALTER TABLE "LoadTestHost" DROP COLUMN IF EXISTS "sudoPassword";
