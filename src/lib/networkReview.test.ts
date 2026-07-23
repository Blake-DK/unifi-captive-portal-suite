import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { poolSize, reviewNetwork, type ReviewInput } from "./networkReview.ts"; // explicit extension for Node's type-stripping runner

const base: ReviewInput = { devices: [], networks: [], wlans: [], wanLinks: [] };
const ids = (recs: { id: string }[]) => recs.map((r) => r.id);

describe("reviewNetwork", () => {
  it("returns nothing for a healthy snapshot", () => {
    assert.deepEqual(
      reviewNetwork({
        ...base,
        devices: [{ mac: "a", state: 1, version: "7.0.0" }],
      }),
      [],
    );
  });

  it("flags mixed firmware across online devices", () => {
    const recs = reviewNetwork({
      ...base,
      devices: [
        { mac: "a", state: 1, version: "7.0.0" },
        { mac: "b", state: 1, version: "6.5.0" },
      ],
    });
    assert.ok(ids(recs).includes("firmware-spread"));
  });

  it("does not count offline devices toward firmware spread", () => {
    const recs = reviewNetwork({
      ...base,
      devices: [
        { mac: "a", state: 1, version: "7.0.0" },
        { mac: "b", state: 0, version: "6.5.0" },
      ],
    });
    assert.ok(!ids(recs).includes("firmware-spread"));
  });

  it("flags a guest SSID on a non-guest network", () => {
    const recs = reviewNetwork({
      ...base,
      networks: [{ _id: "n1", name: "Corp", purpose: "corporate" }],
      wlans: [{ _id: "w1", name: "GuestWiFi", is_guest: true, networkconf_id: "n1" }],
    });
    assert.ok(ids(recs).includes("guest-ssid-nonguest-net-w1"));
  });

  it("does not flag a guest SSID correctly on a guest network", () => {
    const recs = reviewNetwork({
      ...base,
      networks: [{ _id: "n1", name: "GuestNet", purpose: "guest" }],
      wlans: [{ _id: "w1", name: "GuestWiFi", is_guest: true, networkconf_id: "n1" }],
    });
    assert.ok(!ids(recs).some((i) => i.startsWith("guest-ssid-nonguest")));
  });

  it("flags a small guest DHCP pool", () => {
    const recs = reviewNetwork({
      ...base,
      networks: [{
        _id: "n1", name: "Guest", purpose: "guest",
        dhcpd_enabled: true, dhcpd_start: "10.91.0.10", dhcpd_stop: "10.91.0.40",
      }],
    });
    assert.ok(ids(recs).some((i) => i.startsWith("dhcp-small-")));
  });

  it("flags degraded WAN redundancy", () => {
    const recs = reviewNetwork({
      ...base,
      wanLinks: [
        { key: "wan1", name: "WAN", up: true, enabled: true, active: true },
        { key: "wan2", name: "WAN2", up: false, enabled: true, active: false },
      ],
    });
    assert.ok(ids(recs).includes("wan-redundancy-degraded"));
  });
});

describe("poolSize", () => {
  it("counts an inclusive range", () => {
    assert.equal(poolSize("10.91.0.10", "10.91.0.40"), 31);
  });
  it("returns null for a reversed or bad range", () => {
    assert.equal(poolSize("10.91.0.40", "10.91.0.10"), null);
    assert.equal(poolSize("nope", "10.91.0.10"), null);
  });
});

describe("config health checks", () => {
  it("flags an open non-guest SSID and spares open guest SSIDs", () => {
    const recs = reviewNetwork({
      ...base,
      wlans: [
        { _id: "w1", name: "Office", security: "open" },
        { _id: "w2", name: "Hotspot", security: "open", is_guest: true },
      ],
    });
    const rec = recs.find((r) => r.id === "wlan-open-nonguest");
    assert.ok(rec);
    assert.match(rec!.title, /Office/);
    assert.ok(!rec!.title.includes("Hotspot"));
  });

  it("flags WPA1 and disabled PMF, skipping disabled SSIDs", () => {
    const recs = reviewNetwork({
      ...base,
      wlans: [
        { _id: "w1", name: "Legacy", wpa_mode: "wpa1", security: "wpapsk", pmf_mode: "disabled" },
        { _id: "w2", name: "Off", enabled: false, wpa_mode: "wpa1" },
      ],
    });
    assert.ok(ids(recs).includes("wlan-wpa1"));
    assert.ok(ids(recs).includes("wlan-pmf-disabled"));
    assert.ok(!recs.find((r) => r.id === "wlan-wpa1")!.title.includes("Off"));
  });

  it("reads the usg/ips/mgmt setting sections", () => {
    const recs = reviewNetwork({
      ...base,
      siteSettings: [
        { key: "usg", upnp_enabled: true },
        { key: "ips", ips_mode: "disabled" },
        { key: "mgmt", auto_upgrade: false },
      ],
    });
    assert.ok(ids(recs).includes("usg-upnp"));
    assert.ok(ids(recs).includes("ips-disabled"));
    assert.ok(ids(recs).includes("mgmt-auto-upgrade-off"));
  });

  it("stays silent on those checks when the sections are absent", () => {
    const recs = reviewNetwork({ ...base, siteSettings: [] });
    assert.ok(!ids(recs).includes("usg-upnp"));
    assert.ok(!ids(recs).includes("ips-disabled"));
    assert.ok(!ids(recs).includes("mgmt-auto-upgrade-off"));
  });

  it("suggests VLAN segmentation on a single flat network", () => {
    const recs = reviewNetwork({
      ...base,
      networks: [{ _id: "n1", name: "LAN" }],
    });
    assert.ok(ids(recs).includes("flat-network"));
  });

  it("flags SNMP v1/v2c (community string) enabled on the controller", () => {
    const recs = reviewNetwork({
      ...base,
      siteSettings: [{ key: "snmp", enabled: true, community: "public" }],
    });
    assert.ok(ids(recs).includes("snmp-v2c-enabled"));
  });

  it("does not flag v2c when snmp is enabled without a community string", () => {
    const recs = reviewNetwork({
      ...base,
      siteSettings: [{ key: "snmp", enabled: true }],
    });
    assert.ok(!ids(recs).includes("snmp-v2c-enabled"));
  });

  it("flags portal SNMP fallback enabled while the controller's snmp section is off", () => {
    const recs = reviewNetwork({
      ...base,
      siteSettings: [{ key: "snmp", enabled: false }],
      snmpConfigured: true,
    });
    assert.ok(ids(recs).includes("snmp-fallback-unconfigured-on-controller"));
  });

  it("stays silent on the controller-off check when the portal fallback isn't configured", () => {
    const recs = reviewNetwork({
      ...base,
      siteSettings: [{ key: "snmp", enabled: false }],
      snmpConfigured: false,
    });
    assert.ok(!ids(recs).includes("snmp-fallback-unconfigured-on-controller"));
  });
});
