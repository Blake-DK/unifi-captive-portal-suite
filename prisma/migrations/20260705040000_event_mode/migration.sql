-- Event mode: registrations during an active event window are auto-tagged.
CREATE TABLE "Event" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "note" TEXT,
    "durationMin" INTEGER,
    "downKbps" INTEGER,
    "upKbps" INTEGER,
    "quotaMB" INTEGER,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Event_startsAt_idx" ON "Event"("startsAt");

ALTER TABLE "GuestRegistration" ADD COLUMN "eventId" INTEGER;
CREATE INDEX "GuestRegistration_eventId_idx" ON "GuestRegistration"("eventId");
ALTER TABLE "GuestRegistration" ADD CONSTRAINT "GuestRegistration_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
