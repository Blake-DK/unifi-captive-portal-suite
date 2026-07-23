import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateWanLinkAlerts, extractWanLinks, type WanLink } from "./wan.ts"; // explicit extension for Node's type-stripping runner

import type { UniFiWanLink } from "./unifi.ts";

type UptimeStats = Record<string, { availability?: number; latency_average?: number }>;
const gw = (wan1?: UniFiWanLink, wan2?: UniFiWanLink, uptime_stats?: UptimeStats) => ({
  type: "udm",
  wan1,
  wan2,
  uptime_stats,
});

describe("extractWanLinks", () => {
  it("returns both links with active marked by the www wan_ip", () => {
    const links = extractWanLinks(
      [gw(
        { up: true, enable: true, ip: "1.2.3.4", isp_name: "ISP-A" },
        { up: true, enable: true, ip: "5.6.7.8", name: "Backup", isp_name: "ISP-B" },
        { WAN: { availability: 99.9, latency_average: 8 }, WAN2: { availability: 97.5 } },
      )],
      "1.2.3.4",
    );
    assert.equal(links.length, 2);
    assert.deepEqual(links.map((l) => [l.name, l.up, l.active]), [
      ["WAN", true, true],
      ["Backup", true, false],
    ]);
    assert.equal(links[0].availability, 99.9);
    assert.equal(links[1].isp, "ISP-B");
  });

  it("marks a single up link active even without an ip match", () => {
    const links = extractWanLinks([gw({ up: true, enable: true })], undefined);
    assert.equal(links.length, 1);
    assert.equal(links[0].active, true);
  });

  it("carries per-WAN speedtest fields when the gateway reports them", () => {
    const links = extractWanLinks(
      [gw(
        { up: true, enable: true, xput_down: 940.5, xput_up: 42.1, speedtest_ping: 9, speedtest_lastrun: 1_700_000_000 },
        { up: true, enable: true }, // no speedtest fields → undefined, not 0
      )],
      undefined,
    );
    assert.deepEqual(
      [links[0].xputDown, links[0].xputUp, links[0].speedtestPing, links[0].speedtestAt],
      [940.5, 42.1, 9, 1_700_000_000],
    );
    assert.equal(links[1].xputDown, undefined);
    assert.equal(links[1].speedtestAt, undefined);
  });

  it("returns [] when there is no gateway or no wan data", () => {
    assert.deepEqual(extractWanLinks([{ type: "usw" }], "1.2.3.4"), []);
    assert.deepEqual(extractWanLinks([{ type: "udm" }], "1.2.3.4"), []);
  });

  it("prefers the WAN network's friendly name over the gateway's port label", () => {
    const links = extractWanLinks(
      [gw({ up: true, enable: true, name: "eth8" }, { up: true, enable: true, name: "eth9" })],
      undefined,
      [
        { name: "Fiber (DIA)", purpose: "wan", wan_networkgroup: "WAN" },
        { name: "Starlink Backup", purpose: "wan", wan_networkgroup: "WAN2" },
        { name: "Corp", purpose: "corporate" }, // never matches a WAN slot
      ],
    );
    assert.deepEqual(links.map((l) => l.name), ["Fiber (DIA)", "Starlink Backup"]);
  });

  it("treats a wan network without wan_networkgroup as the first WAN, and falls back per link", () => {
    const links = extractWanLinks(
      [gw({ up: true, enable: true, name: "eth8" }, { up: true, enable: true })],
      undefined,
      [{ name: "Uplink", purpose: "wan" }],
    );
    // wan1 gets the friendly name; wan2 has no matching network and no label.
    assert.deepEqual(links.map((l) => l.name), ["Uplink", "WAN2"]);
  });
});

const upLink = (key: "wan1" | "wan2", over: Partial<WanLink> = {}): WanLink => ({
  key,
  name: key === "wan1" ? "WAN" : "WAN2",
  up: true,
  enabled: true,
  active: false,
  ...over,
});

describe("evaluateWanLinkAlerts", () => {
  it("is silent when both links are up", () => {
    assert.deepEqual(evaluateWanLinkAlerts([upLink("wan1", { active: true }), upLink("wan2")]), []);
  });

  it("warns when the backup is down but the site still has a link", () => {
    const alerts = evaluateWanLinkAlerts([
      upLink("wan1", { active: true }),
      upLink("wan2", { up: false, isp: "ISP-B" }),
    ]);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].severity, "warning");
    assert.equal(alerts[0].target, "wanlink:wan2");
    assert.match(alerts[0].message, /redundancy lost/);
    assert.match(alerts[0].targetName, /ISP-B/);
  });

  it("errors per link when nothing is up", () => {
    const alerts = evaluateWanLinkAlerts([
      upLink("wan1", { up: false }),
      upLink("wan2", { up: false }),
    ]);
    assert.equal(alerts.length, 2);
    assert.ok(alerts.every((a) => a.severity === "error"));
  });

  it("ignores disabled links and single-WAN sites", () => {
    // Disabled second link = effectively single-WAN; the subsystem rule owns it.
    assert.deepEqual(
      evaluateWanLinkAlerts([upLink("wan1", { up: false }), upLink("wan2", { enabled: false, up: false })]),
      [],
    );
    assert.deepEqual(evaluateWanLinkAlerts([upLink("wan1", { up: false })]), []);
  });
});
