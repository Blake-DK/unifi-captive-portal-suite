/**
 * In-process record of the bundled Traefik's config polling, so the
 * Settings → URLs page can show "traefik hasn't fetched config recently"
 * and WHY (a stopped container, wrong token, or DB trouble all look like
 * plain staleness otherwise). Process-local on purpose: it answers "is the
 * proxy talking to THIS instance", which is exactly the question.
 */
let lastPolledAt: number | null = null;
let lastDeniedAt: number | null = null;
let lastErrorAt: number | null = null;

export function markTraefikPolled(): void {
  lastPolledAt = Date.now();
}

/** A poll presented a wrong/missing token — stale traefik.yml or a probe. */
export function markTraefikDenied(): void {
  lastDeniedAt = Date.now();
}

/** A poll failed server-side (DB unavailable) — Traefik keeps last-good. */
export function markTraefikError(): void {
  lastErrorAt = Date.now();
}

export function traefikLastPolledAt(): string | null {
  return lastPolledAt ? new Date(lastPolledAt).toISOString() : null;
}

export function traefikLastDeniedAt(): string | null {
  return lastDeniedAt ? new Date(lastDeniedAt).toISOString() : null;
}

export function traefikLastErrorAt(): string | null {
  return lastErrorAt ? new Date(lastErrorAt).toISOString() : null;
}
