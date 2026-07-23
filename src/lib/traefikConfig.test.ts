import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDynamicConfig, isIpHost, slug, toYaml } from "./traefikConfig.ts"; // explicit extension for Node's type-stripping runner

const base = {
  portalBaseUrl: "http://10.90.0.189",
  guestBaseUrl: "https://wifi.example.com",
  adminBaseUrl: "https://portal-adm.example.com",
  portalServiceUrl: "http://portal:3000",
  resources: [],
};

describe("buildDynamicConfig", () => {
  it("always emits the portal service and a priority-1 catch-all on :80", () => {
    const cfg = buildDynamicConfig(base);
    assert.deepEqual(cfg.http.services["portal"].loadBalancer.servers, [
      { url: "http://portal:3000" },
    ]);
    const c = cfg.http.routers["portal-catchall"];
    assert.equal(c.priority, 1);
    assert.deepEqual(c.entryPoints, ["web"]);
    assert.equal(c.service, "portal");
  });

  it("skips a bare-IP captive host (catch-all covers it) but routes hostname captive URLs", () => {
    assert.equal(buildDynamicConfig(base).http.routers["portal-captive"], undefined);
    const cfg = buildDynamicConfig({ ...base, portalBaseUrl: "https://wifi-login.example.com" });
    assert.equal(cfg.http.routers["portal-captive"].rule, "Host(`wifi-login.example.com`)");
    assert.ok(cfg.http.routers["portal-captive-admin-block"], "captive host is guest-facing");
  });

  it("gives HTTPS hosts a certResolver, an HTTP→HTTPS redirect router, and no global redirect", () => {
    const cfg = buildDynamicConfig(base);
    const guest = cfg.http.routers["portal-guest"];
    assert.deepEqual(guest.tls, { certResolver: "cloudflare" });
    assert.deepEqual(guest.entryPoints, ["websecure"]);
    const redirect = cfg.http.routers["portal-guest-http"];
    assert.deepEqual(redirect.middlewares, ["portal-redirect-https"]);
    assert.ok(cfg.http.middlewares["portal-redirect-https"]);
    // The catch-all must NOT redirect — bare-IP captive hits stay plain HTTP.
    assert.equal(cfg.http.routers["portal-catchall"].middlewares, undefined);
  });

  it("blocks /admin + /api/admin on guest-facing hosts only, at higher priority", () => {
    const cfg = buildDynamicConfig(base);
    const block = cfg.http.routers["portal-guest-admin-block"];
    assert.match(block.rule, /PathPrefix\(`\/admin`\)/);
    assert.match(block.rule, /PathPrefix\(`\/api\/admin`\)/);
    assert.equal(block.priority, 100);
    assert.deepEqual(block.middlewares, ["portal-deny-all"]);
    assert.ok(cfg.http.middlewares["portal-deny-all"]);
    assert.equal(cfg.http.routers["portal-admin-admin-block"], undefined, "admin host is not blocked");
  });

  it("emits routers + services for enabled extra resources and skips disabled/blank ones", () => {
    const cfg = buildDynamicConfig({
      ...base,
      resources: [
        { name: "Home Assistant", hostname: "ha.example.com", targetUrl: "http://10.90.0.50:8123", tls: true, blockAdminPaths: false, enabled: true },
        { name: "Disabled", hostname: "off.example.com", targetUrl: "http://10.90.0.51", tls: false, blockAdminPaths: false, enabled: false },
        { name: "Blank", hostname: "", targetUrl: "http://x", tls: false, blockAdminPaths: false, enabled: true },
      ],
    });
    const key = "portal-res-home-assistant";
    assert.deepEqual(cfg.http.services[key].loadBalancer.servers, [{ url: "http://10.90.0.50:8123" }]);
    assert.equal(cfg.http.routers[key].rule, "Host(`ha.example.com`)");
    assert.deepEqual(cfg.http.routers[key].tls, { certResolver: "cloudflare" });
    assert.equal(Object.keys(cfg.http.routers).filter((k) => k.startsWith("portal-res-")).length, 2, "main + redirect only");
  });

  it("plain-HTTP resources get a web router with no TLS and no redirect", () => {
    const cfg = buildDynamicConfig({
      ...base,
      resources: [
        { name: "printer", hostname: "print.lan", targetUrl: "http://10.90.0.60", tls: false, blockAdminPaths: false, enabled: true },
      ],
    });
    const r = cfg.http.routers["portal-res-printer"];
    assert.deepEqual(r.entryPoints, ["web"]);
    assert.equal(r.tls, undefined);
    assert.equal(cfg.http.routers["portal-res-printer-http"], undefined);
  });

  it("https upstreams get the insecure-skip-verify transport; http/h2c do not", () => {
    const cfg = buildDynamicConfig({
      ...base,
      resources: [
        { name: "unifi", hostname: "unifi.example.com", targetUrl: "https://10.90.0.1", tls: true, blockAdminPaths: false, enabled: true },
        { name: "grpc", hostname: "grpc.example.com", targetUrl: "h2c://10.90.0.70:50051", tls: true, blockAdminPaths: false, enabled: true },
      ],
    });
    assert.equal(cfg.http.services["portal-res-unifi"].loadBalancer.serversTransport, "portal-insecure-upstream");
    assert.deepEqual(cfg.http.serversTransports, { "portal-insecure-upstream": { insecureSkipVerify: true } });
    assert.equal(cfg.http.services["portal-res-grpc"].loadBalancer.serversTransport, undefined);
    assert.deepEqual(cfg.http.services["portal-res-grpc"].loadBalancer.servers, [{ url: "h2c://10.90.0.70:50051" }]);
  });

  it("external mode just swaps the portal service URL", () => {
    const cfg = buildDynamicConfig({ ...base, portalServiceUrl: "http://10.90.0.189:8080" });
    assert.deepEqual(cfg.http.services["portal"].loadBalancer.servers, [
      { url: "http://10.90.0.189:8080" },
    ]);
  });

  it("does not duplicate routers when guest and admin share a hostname", () => {
    const cfg = buildDynamicConfig({ ...base, adminBaseUrl: "https://wifi.example.com" });
    assert.equal(cfg.http.routers["portal-admin"], undefined);
    assert.ok(cfg.http.routers["portal-guest"]);
  });

  it("routes the admin host at its own service when adminServiceUrl is set (split)", () => {
    const cfg = buildDynamicConfig({ ...base, adminServiceUrl: "http://portal-admin:3000" });
    assert.deepEqual(cfg.http.services["portal-admin"].loadBalancer.servers, [
      { url: "http://portal-admin:3000" },
    ]);
    assert.equal(cfg.http.routers["portal-admin"].service, "portal-admin");
    // The HTTP→HTTPS redirect router for the admin host follows the split too.
    assert.equal(cfg.http.routers["portal-admin-http"].service, "portal-admin");
    // Everything guest-facing stays on the shared portal service.
    assert.equal(cfg.http.routers["portal-guest"].service, "portal");
    assert.equal(cfg.http.routers["portal-catchall"].service, "portal");
  });

  it("without adminServiceUrl the admin host rides the portal service (pre-split output)", () => {
    const cfg = buildDynamicConfig(base);
    assert.equal(cfg.http.services["portal-admin"], undefined);
    assert.equal(cfg.http.routers["portal-admin"].service, "portal");
  });

  it("emits no orphan admin service when guest and admin share a hostname", () => {
    const cfg = buildDynamicConfig({
      ...base,
      adminBaseUrl: "https://wifi.example.com",
      adminServiceUrl: "http://portal-admin:3000",
    });
    assert.equal(cfg.http.services["portal-admin"], undefined);
    assert.equal(cfg.http.routers["portal-admin"], undefined);
  });

  it("skips the admin router when admin shares the CAPTIVE hostname (no colliding Host rule)", () => {
    // Same hostname for the captive portal and admin URLs: a second admin
    // router with an identical Host() rule would collide and, in a split, could
    // send captive traffic to the admin container.
    const cfg = buildDynamicConfig({
      ...base,
      portalBaseUrl: "https://wifi.example.com",
      adminBaseUrl: "https://wifi.example.com",
      adminServiceUrl: "http://portal-admin:3000",
    });
    assert.equal(cfg.http.services["portal-admin"], undefined);
    assert.equal(cfg.http.routers["portal-admin"], undefined);
    // The captive router still exists and rides the guest-serving portal service.
    assert.equal(cfg.http.routers["portal-captive"].service, "portal");
  });
});

describe("buildDynamicConfig logdash", () => {
  const logdash = { host: "logs.example.com", serviceUrl: "http://logdash:3000" };

  it("emits an HTTPS-only router forwardAuth'd at the portal", () => {
    const cfg = buildDynamicConfig({ ...base, logdash });
    const r = cfg.http.routers["portal-logdash"];
    assert.equal(r.rule, "Host(`logs.example.com`)");
    assert.deepEqual(r.entryPoints, ["websecure"]);
    assert.deepEqual(r.tls, { certResolver: "cloudflare" });
    assert.deepEqual(r.middlewares, ["portal-logdash-auth"]);
    assert.deepEqual(cfg.http.middlewares["portal-logdash-auth"], {
      forwardAuth: { address: "http://portal:3000/api/logdash-auth" },
    });
    assert.deepEqual(cfg.http.services["portal-logdash"].loadBalancer.servers, [
      { url: "http://logdash:3000" },
    ]);
    // Plain HTTP redirects — session cookies must never travel unencrypted.
    assert.deepEqual(cfg.http.routers["portal-logdash-http"].middlewares, [
      "portal-redirect-https",
    ]);
    assert.ok(cfg.http.middlewares["portal-redirect-https"]);
  });

  it("forwardAuth follows the admin upstream in a split", () => {
    const cfg = buildDynamicConfig({
      ...base,
      adminServiceUrl: "http://portal-admin:3000",
      logdash,
    });
    assert.deepEqual(cfg.http.middlewares["portal-logdash-auth"], {
      forwardAuth: { address: "http://portal-admin:3000/api/logdash-auth" },
    });
  });

  it("skips blank, bare-IP, and portal-colliding hosts", () => {
    for (const host of ["", "10.90.0.189", "wifi.example.com", "portal-adm.example.com"]) {
      const cfg = buildDynamicConfig({ ...base, logdash: { ...logdash, host } });
      assert.equal(cfg.http.routers["portal-logdash"], undefined, `host "${host}"`);
    }
  });
});

describe("helpers", () => {
  it("isIpHost", () => {
    assert.equal(isIpHost("10.90.0.189"), true);
    assert.equal(isIpHost("wifi.example.com"), false);
  });

  it("slug", () => {
    assert.equal(slug("Home Assistant!"), "home-assistant");
    assert.equal(slug("---"), "res");
  });

  it("toYaml emits parse-stable YAML for the config shape", () => {
    const y = toYaml(buildDynamicConfig(base));
    assert.match(y, /portal-guest:\n\s+rule: "Host\(`wifi\.example\.com`\)"/);
    assert.match(y, /sourceRange:\n\s+- "255\.255\.255\.255\/32"/);
    assert.doesNotMatch(y, /\[object/);
  });
});
