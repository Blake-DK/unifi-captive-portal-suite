import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  adminUpstreamUrl,
  ownsProxyControlPlane,
  portalMode,
  schedulersEnabled,
  splitProfileActive,
} from "./portalMode.ts";

const orig = {
  PORTAL_MODE: process.env.PORTAL_MODE,
  SCHEDULERS: process.env.SCHEDULERS,
  ADMIN_UPSTREAM_URL: process.env.ADMIN_UPSTREAM_URL,
  COMPOSE_PROFILES: process.env.COMPOSE_PROFILES,
};

function restore(key: keyof typeof orig) {
  if (orig[key] === undefined) delete process.env[key];
  else process.env[key] = orig[key];
}

afterEach(() => {
  (Object.keys(orig) as (keyof typeof orig)[]).forEach(restore);
});

/** Put this process into a bundled split guest/admin role. */
function bundledSplit(mode: "guest" | "admin") {
  process.env.PORTAL_MODE = mode;
  process.env.COMPOSE_PROFILES = "traefik,split";
  delete process.env.ADMIN_UPSTREAM_URL;
}

describe("portalMode", () => {
  it("defaults to 'all' when unset or unrecognised (backward compatible)", () => {
    delete process.env.PORTAL_MODE;
    assert.equal(portalMode(), "all");
    process.env.PORTAL_MODE = "nonsense";
    assert.equal(portalMode(), "all");
  });
  it("reads guest/admin, case-insensitively", () => {
    process.env.PORTAL_MODE = "guest";
    assert.equal(portalMode(), "guest");
    process.env.PORTAL_MODE = "ADMIN";
    assert.equal(portalMode(), "admin");
  });
});

describe("splitProfileActive", () => {
  it("is true only when 'split' is a member of COMPOSE_PROFILES", () => {
    delete process.env.COMPOSE_PROFILES;
    assert.equal(splitProfileActive(), false);
    process.env.COMPOSE_PROFILES = "traefik";
    assert.equal(splitProfileActive(), false);
    process.env.COMPOSE_PROFILES = "traefik,split";
    assert.equal(splitProfileActive(), true);
    process.env.COMPOSE_PROFILES = "split, traefik";
    assert.equal(splitProfileActive(), true);
  });
});

describe("schedulersEnabled", () => {
  it("runs by default", () => {
    delete process.env.PORTAL_MODE;
    delete process.env.SCHEDULERS;
    assert.equal(schedulersEnabled(), true);
  });
  it("is off for a guest process or when SCHEDULERS=off", () => {
    process.env.PORTAL_MODE = "guest";
    delete process.env.SCHEDULERS;
    assert.equal(schedulersEnabled(), false);
    process.env.PORTAL_MODE = "admin";
    process.env.SCHEDULERS = "off";
    assert.equal(schedulersEnabled(), false);
  });
});

describe("ownsProxyControlPlane", () => {
  it("is owned by an all-mode or admin process", () => {
    delete process.env.PORTAL_MODE;
    delete process.env.COMPOSE_PROFILES;
    assert.equal(ownsProxyControlPlane(), true);
    bundledSplit("admin");
    assert.equal(ownsProxyControlPlane(), true);
  });
  it("is yielded by a guest process ONLY when the split profile is active", () => {
    bundledSplit("guest");
    assert.equal(ownsProxyControlPlane(), false);
    // A lone PORTAL_MODE=guest without the profile (misconfig) still owns it,
    // so it can't brick its own routing.
    process.env.PORTAL_MODE = "guest";
    delete process.env.COMPOSE_PROFILES;
    assert.equal(ownsProxyControlPlane(), true);
  });
});

describe("adminUpstreamUrl", () => {
  it("is blank for an unsplit deployment (all mode)", () => {
    delete process.env.PORTAL_MODE;
    delete process.env.ADMIN_UPSTREAM_URL;
    process.env.COMPOSE_PROFILES = "traefik";
    assert.equal(adminUpstreamUrl("bundled"), "");
  });
  it("defaults to the compose sibling for a bundled split role", () => {
    bundledSplit("guest");
    assert.equal(adminUpstreamUrl("bundled"), "http://portal-admin:3000");
    bundledSplit("admin");
    assert.equal(adminUpstreamUrl("bundled"), "http://portal-admin:3000");
  });
  it("never guesses the compose name without the split profile (fixes lone-role brick)", () => {
    process.env.PORTAL_MODE = "admin";
    delete process.env.COMPOSE_PROFILES;
    delete process.env.ADMIN_UPSTREAM_URL;
    assert.equal(adminUpstreamUrl("bundled"), "");
  });
  it("never guesses the compose name for an external Traefik", () => {
    bundledSplit("guest");
    assert.equal(adminUpstreamUrl("external"), "");
  });
  it("lets an explicit ADMIN_UPSTREAM_URL win for a split role, trailing slash trimmed", () => {
    process.env.PORTAL_MODE = "admin";
    process.env.ADMIN_UPSTREAM_URL = "http://10.90.0.189:8081/";
    delete process.env.COMPOSE_PROFILES;
    assert.equal(adminUpstreamUrl("external"), "http://10.90.0.189:8081");
  });
  it("ignores a stale ADMIN_UPSTREAM_URL once the split is backed out (all mode)", () => {
    process.env.ADMIN_UPSTREAM_URL = "http://10.90.0.189:8081";
    delete process.env.PORTAL_MODE;
    delete process.env.COMPOSE_PROFILES;
    assert.equal(adminUpstreamUrl("external"), "");
  });
});
