/**
 * Parsing/classification of the docker-status.json the traefik-ops sidecar
 * publishes into the shared ./traefik mount (the portal deliberately holds no
 * docker socket — the sidecar is the only container that does, and it rewrites
 * this file every ~10s; see scripts/traefik-ops-watch.sh). Pure module — no
 * fs, no prisma — so it unit-tests without a runtime environment.
 */

export type ContainerStatus = {
  name: string;
  /** docker's State field: running / exited / restarting / paused / … */
  state: string;
  /** docker's human Status line, health embedded: "Up 3 days (healthy)". */
  status: string;
  image: string;
  /** Running and not unhealthy. */
  ok: boolean;
  /** Running but the healthcheck hasn't settled yet ("health: starting"). */
  warn: boolean;
};

export type DockerStatusSnapshot = {
  generatedAt: string | null;
  /** True when the file is older than the sidecar's write cadence allows. */
  stale: boolean;
  containers: ContainerStatus[];
};

/** Sidecar writes every ~10s; three missed writes = something is wrong. */
export const DOCKER_STATUS_STALE_MS = 30_000;

export function classifyContainer(c: unknown): ContainerStatus {
  const o = (c ?? {}) as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name : "";
  const state = typeof o.state === "string" ? o.state : "";
  const status = typeof o.status === "string" ? o.status : "";
  const image = typeof o.image === "string" ? o.image : "";
  const unhealthy = /\(unhealthy\)/i.test(status);
  const starting = /\(health: starting\)/i.test(status);
  // Anything not plainly running (exited, restarting = crash loop, paused,
  // created) is a failure, not a warning — the stack is supposed to be up.
  const ok = state === "running" && !unhealthy;
  return { name, state, status, image, ok, warn: ok && starting };
}

/** Throws on malformed JSON — the caller treats that as "no status". */
export function parseDockerStatus(raw: string, nowMs: number): DockerStatusSnapshot {
  const data = JSON.parse(raw) as { generatedAt?: unknown; containers?: unknown };
  const generatedAt = typeof data.generatedAt === "string" ? data.generatedAt : null;
  const ageMs = generatedAt ? nowMs - new Date(generatedAt).getTime() : null;
  return {
    generatedAt,
    stale: ageMs === null || Number.isNaN(ageMs) || ageMs > DOCKER_STATUS_STALE_MS,
    containers: Array.isArray(data.containers) ? data.containers.map(classifyContainer) : [],
  };
}
