import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkSplitConfig, type SplitConfigInput } from "./splitConfig.ts";

const healthySplit: SplitConfigInput = {
  mode: "guest",
  splitProfileActive: true,
  reverseProxyMode: "bundled",
  adminUpstreamUrl: "http://portal-admin:3000",
  portalHost: "wifi.example.com",
  guestHost: "wifi.example.com",
  adminHost: "portal-adm.example.com",
  adminHostIsIp: false,
};

describe("checkSplitConfig", () => {
  it("is silent for a healthy bundled split", () => {
    assert.deepEqual(checkSplitConfig(healthySplit), []);
  });

  it("is silent for a plain single-container deployment", () => {
    assert.deepEqual(
      checkSplitConfig({
        mode: "all",
        splitProfileActive: false,
        reverseProxyMode: "bundled",
        adminUpstreamUrl: "",
        portalHost: "wifi.example.com",
        guestHost: "",
        adminHost: "portal-adm.example.com",
        adminHostIsIp: false,
      }),
      [],
    );
  });

  it("warns when the split profile is on but PORTAL_MODE is unset", () => {
    const w = checkSplitConfig({ ...healthySplit, mode: "all" });
    assert.equal(w.length, 1);
    assert.match(w[0], /PORTAL_MODE is unset/);
  });

  it("warns when PORTAL_MODE is set but the split profile is off (bundled)", () => {
    const w = checkSplitConfig({
      ...healthySplit,
      splitProfileActive: false,
      adminUpstreamUrl: "",
    });
    assert.equal(w.length, 1);
    assert.match(w[0], /"split" compose profile is not active/);
  });

  it("warns when an external split has no ADMIN_UPSTREAM_URL", () => {
    const w = checkSplitConfig({
      ...healthySplit,
      mode: "admin",
      splitProfileActive: false,
      reverseProxyMode: "external",
      adminUpstreamUrl: "",
    });
    assert.equal(w.length, 1);
    assert.match(w[0], /ADMIN_UPSTREAM_URL/);
  });

  it("warns when a routing split has a blank or bare-IP admin URL", () => {
    assert.match(
      checkSplitConfig({ ...healthySplit, adminHost: "" })[0],
      /blank or/,
    );
    assert.match(
      checkSplitConfig({ ...healthySplit, adminHost: "10.90.0.5", adminHostIsIp: true })[0],
      /blank or/,
    );
  });

  it("warns when the admin URL shares the guest/captive hostname under a split", () => {
    const w = checkSplitConfig({ ...healthySplit, adminHost: "wifi.example.com" });
    assert.equal(w.length, 1);
    assert.match(w[0], /shares its hostname/);
  });
});
