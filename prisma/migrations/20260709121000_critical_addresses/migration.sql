-- Critical addresses (comma-separated IPs/CIDRs) for the Network review
-- firewall guard: applies that would cut one off are refused outright.
ALTER TABLE "SystemSettings" ADD COLUMN "criticalAddresses" TEXT NOT NULL DEFAULT '';
