-- Networks marked PCI-scoped (comma-separated controller network ids) for the
-- Network review segmentation check.
ALTER TABLE "SystemSettings" ADD COLUMN "pciNetworkIds" TEXT NOT NULL DEFAULT '';
