import { prisma } from "./prisma";
import type { SystemSettings } from "@prisma/client";

/**
 * One short-lived cache for the SystemSettings row (`id: "config"`).
 *
 * Nearly every request reads this row, and a guest registration reads it
 * five or six times across the config/settings/mail helpers. Before this
 * cache, getSystemSettings even upserted it per call, taking a row lock on
 * the hottest row in the schema. Under a registration burst that was pure
 * pool pressure for a value that changes maybe once a week.
 *
 * Every write site calls invalidateSettingsRow(), so admin changes apply
 * immediately; the TTL only bounds staleness for writes we don't know about
 * (manual SQL, a second instance).
 */
const TTL_MS = 15_000;

let cache: { at: number; row: SystemSettings | null } | null = null;
let inFlight: Promise<SystemSettings | null> | null = null;

export async function getSettingsRow(): Promise<SystemSettings | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.row;
  if (!inFlight) {
    inFlight = prisma.systemSettings
      .findUnique({ where: { id: "config" } })
      .then((row) => {
        cache = { at: Date.now(), row };
        return row;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Seed the cache with a row just written elsewhere (first-boot create). */
export function primeSettingsRow(row: SystemSettings): void {
  cache = { at: Date.now(), row };
}

/** Call after ANY write to the settings row so the change applies at once. */
export function invalidateSettingsRow(): void {
  cache = null;
}
