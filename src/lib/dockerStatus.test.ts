import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyContainer, parseDockerStatus, DOCKER_STATUS_STALE_MS } from "./dockerStatus.ts";

const NOW = new Date("2026-07-12T12:00:00Z").getTime();

/** A docker-status.json the sidecar would write, `secondsAgo` in the past. */
function statusFile(secondsAgo: number, containers: unknown[]) {
  return JSON.stringify({
    generatedAt: new Date(NOW - secondsAgo * 1000).toISOString(),
    containers,
  });
}

describe("classifyContainer", () => {
  it("marks a running healthy container ok", () => {
    const c = classifyContainer({
      name: "unifi-captive-portal",
      state: "running",
      status: "Up 3 days (healthy)",
      image: "ghcr.io/example-org/unifi-captiveportal:nightly",
    });
    assert.equal(c.ok, true);
    assert.equal(c.warn, false);
  });
  it("marks running without a healthcheck ok (the ops sidecar has none)", () => {
    const c = classifyContainer({ name: "x-traefik-ops", state: "running", status: "Up 2 hours", image: "docker:27-cli" });
    assert.equal(c.ok, true);
    assert.equal(c.warn, false);
  });
  it("marks '(health: starting)' as a warning, not a failure", () => {
    const c = classifyContainer({ name: "x", state: "running", status: "Up 5 seconds (health: starting)", image: "i" });
    assert.equal(c.ok, true);
    assert.equal(c.warn, true);
  });
  it("fails unhealthy, exited and restarting containers", () => {
    for (const [state, status] of [
      ["running", "Up 10 minutes (unhealthy)"],
      ["exited", "Exited (1) 2 minutes ago"],
      ["restarting", "Restarting (1) 5 seconds ago"],
    ] as const) {
      const c = classifyContainer({ name: "x", state, status, image: "i" });
      assert.equal(c.ok, false, `${state} should not be ok`);
      assert.equal(c.warn, false);
    }
  });
  it("tolerates malformed entries without throwing", () => {
    const c = classifyContainer(null);
    assert.equal(c.ok, false);
    assert.equal(c.name, "");
  });
});

describe("parseDockerStatus", () => {
  it("parses a fresh file as not stale", () => {
    const s = parseDockerStatus(statusFile(10, [{ name: "a", state: "running", status: "Up", image: "i" }]), NOW);
    assert.equal(s.stale, false);
    assert.equal(s.containers.length, 1);
    assert.equal(s.containers[0].ok, true);
  });
  it("flags a file older than the stale window", () => {
    const s = parseDockerStatus(statusFile(DOCKER_STATUS_STALE_MS / 1000 + 1, []), NOW);
    assert.equal(s.stale, true);
  });
  it("treats a missing or unparseable timestamp as stale", () => {
    assert.equal(parseDockerStatus(JSON.stringify({ containers: [] }), NOW).stale, true);
    assert.equal(parseDockerStatus(JSON.stringify({ generatedAt: "yesterday-ish", containers: [] }), NOW).stale, true);
  });
  it("yields no containers for a malformed containers field", () => {
    const s = parseDockerStatus(JSON.stringify({ generatedAt: new Date(NOW).toISOString(), containers: "nope" }), NOW);
    assert.deepEqual(s.containers, []);
  });
  it("throws on malformed JSON (caller shows 'status unavailable')", () => {
    assert.throws(() => parseDockerStatus("{truncated", NOW));
  });
});
