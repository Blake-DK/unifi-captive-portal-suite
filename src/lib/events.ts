import { prisma } from "./prisma";
import type { Event } from "@prisma/client";

/**
 * Event mode: an event is "active" when now is within [startsAt, endsAt] and
 * it hasn't been manually closed. New registrations during an active event get
 * tagged with it. If two windows overlap, the most-recently-started wins.
 */
export async function getActiveEvent(now = new Date()): Promise<Event | null> {
  return prisma.event.findFirst({
    where: { startsAt: { lte: now }, endsAt: { gte: now }, closedAt: null },
    orderBy: { startsAt: "desc" },
  });
}

export type EventPlanOverride = {
  durationMin?: number | null;
  downKbps?: number | null;
  upKbps?: number | null;
};

/** An event's plan overrides sit above the location plan (below a voucher). */
export function eventOverride(event: Pick<Event, "durationMin" | "downKbps" | "upKbps" | "quotaMB"> | null) {
  if (!event) return null;
  return {
    durationMin: event.durationMin,
    downKbps: event.downKbps,
    upKbps: event.upKbps,
    quotaMB: event.quotaMB,
  };
}
