-- Consent records (Phase 16 #13): each registration stores a fingerprint of
-- the terms text the guest accepted, so "which version did they consent to"
-- is answerable after the terms change.
ALTER TABLE "GuestRegistration" ADD COLUMN "consentTermsHash" TEXT;
