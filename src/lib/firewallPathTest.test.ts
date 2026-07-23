import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PlanNetwork } from "./firewallPlan.ts"; // explicit extension for Node's type-stripping runner
import type { ZbfZone } from "./zbfPlan.ts";
import { testFirewallPath } from "./firewallPathTest.ts";

const corp: PlanNetwork = { id: "c1", name: "Corp", subnet: "10.90.0.0/24", isGuest: false };
const guest: PlanNetwork = { id: "g1", name: "Guest", subnet: "10.91.0.0/24", isGuest: true };
const nets = [corp, guest];
const internal: ZbfZone = { id: "zi", name: "Internal", networkIds: ["c1"] };
const hotspot: ZbfZone = { id: "zh", name: "Hotspot", networkIds: ["g1"] };
const zones = [internal, hotspot];

const zbfBase = { networks: nets, zones, rules: null };

const allow53 = {
  name: "Portal: Allow zone Hotspot → DNS 10.90.0.5 :53",
  index: 10000,
  action: "ALLOW",
  source: { zone_id: "zh", matching_target: "ANY" },
  destination: { zone_id: "zi", matching_target: "IP", ips: ["10.90.0.5"], port_matching_type: "SPECIFIC", port: "53" },
};
const isolate = {
  name: "Portal: Isolate zone Hotspot",
  index: 10001,
  action: "BLOCK",
  source: { zone_id: "zh", matching_target: "ANY" },
  destination: { zone_id: "zi", matching_target: "ANY" },
};

describe("testFirewallPath (zone-based)", () => {
  it("first match wins: port-specific allow, then the block", () => {
    const withPort = testFirewallPath({
      ...zbfBase,
      srcIp: "10.91.0.9",
      dstIp: "10.90.0.5",
      port: "53",
      policies: [allow53, isolate],
    });
    assert.equal(withPort.verdict, "allowed");
    assert.match(withPort.matched!.name, /DNS/);

    const otherPort = testFirewallPath({
      ...zbfBase,
      srcIp: "10.91.0.9",
      dstIp: "10.90.0.5",
      port: "443",
      policies: [allow53, isolate],
    });
    assert.equal(otherPort.verdict, "blocked");
    assert.match(otherPort.matched!.name, /Isolate/);
  });

  it("portless test lands on the block but reports the partial allow", () => {
    const r = testFirewallPath({
      ...zbfBase,
      srcIp: "10.91.0.9",
      dstIp: "10.90.0.5",
      policies: [allow53, isolate],
    });
    assert.equal(r.verdict, "blocked");
    assert.equal(r.partialAllows.length, 1);
    assert.match(r.partialAllows[0], /port 53/);
  });

  it("intra-zone traffic is not firewalled", () => {
    const r = testFirewallPath({
      ...zbfBase,
      srcIp: "10.90.0.9",
      dstIp: "10.90.0.5",
      policies: [isolate],
    });
    assert.equal(r.verdict, "not-firewalled");
  });

  it("falls to the zone-matrix default when nothing matches", () => {
    const r = testFirewallPath({
      ...zbfBase,
      srcIp: "10.90.0.9",
      dstIp: "10.91.0.5",
      policies: [allow53, isolate],
    });
    assert.equal(r.verdict, "default");
  });

  it("unknown placement asks for an explicit network, and the override fixes it", () => {
    const unknown = testFirewallPath({
      ...zbfBase,
      srcIp: "172.16.0.9",
      dstIp: "10.90.0.5",
      policies: [isolate],
    });
    assert.equal(unknown.verdict, "unknown");

    const placed = testFirewallPath({
      ...zbfBase,
      srcIp: "172.16.0.9",
      srcNetworkId: "g1",
      dstIp: "10.90.0.5",
      policies: [isolate],
    });
    assert.equal(placed.verdict, "blocked");
    assert.equal(placed.src.zone, "Hotspot");
  });

  it("places a public destination in the internet zone and matches its policies", () => {
    const external: ZbfZone = { id: "ze", name: "External", networkIds: ["w1"] };
    const blockGuestWan = {
      name: "Block Guest → Internet",
      index: 10002,
      action: "BLOCK",
      source: { zone_id: "zh", matching_target: "ANY" },
      destination: { zone_id: "ze", matching_target: "ANY" },
    };
    const r = testFirewallPath({
      ...zbfBase,
      zones: [...zones, external],
      internetZone: external,
      srcIp: "10.91.0.9",
      dstIp: "8.8.8.8",
      policies: [blockGuestWan],
    });
    assert.equal(r.verdict, "blocked");
    assert.equal(r.dst.zone, "External");
    assert.match(r.notes.join(" "), /treated as Internet/);
  });

  it("the internet sentinel forces the WAN side; a lone private IP still errors", () => {
    const external: ZbfZone = { id: "ze", name: "External", networkIds: ["w1"] };
    const forced = testFirewallPath({
      ...zbfBase,
      zones: [...zones, external],
      internetZone: external,
      srcIp: "10.90.0.9",
      dstIp: "172.16.0.9",
      dstNetworkId: "internet",
      policies: [],
    });
    assert.equal(forced.dst.zone, "External");
    assert.equal(forced.verdict, "default");

    const typo = testFirewallPath({
      ...zbfBase,
      zones: [...zones, external],
      internetZone: external,
      srcIp: "10.90.0.9",
      dstIp: "172.16.0.9",
      policies: [],
    });
    assert.equal(typo.verdict, "unknown");
  });

  it("respects protocol filters", () => {
    const tcpOnly = {
      ...allow53,
      protocol: "tcp",
      destination: { ...allow53.destination },
    };
    const r = testFirewallPath({
      ...zbfBase,
      srcIp: "10.91.0.9",
      dstIp: "10.90.0.5",
      port: "53",
      protocol: "udp",
      policies: [tcpOnly, isolate],
    });
    assert.equal(r.verdict, "blocked");
  });
});

describe("testFirewallPath (classic)", () => {
  it("matches drops by subnet overlap and flags the heuristic", () => {
    const r = testFirewallPath({
      srcIp: "10.91.0.9",
      dstIp: "10.90.0.5",
      networks: nets,
      zones: null,
      policies: null,
      rules: [
        { name: "Isolate Guest", rule_index: 2001, action: "drop", src_address: "10.91.0.0/24", dst_address: "10.90.0.0/24" },
      ],
    });
    assert.equal(r.verdict, "blocked");
    assert.match(r.notes.join(" "), /heuristic/);
  });

  it("same-network traffic is not firewalled", () => {
    const r = testFirewallPath({
      srcIp: "10.90.0.9",
      dstIp: "10.90.0.5",
      networks: nets,
      zones: null,
      policies: null,
      rules: [],
    });
    assert.equal(r.verdict, "not-firewalled");
  });
});

describe("predefined zone defaults in the path test", () => {
  it("custom block beats a lower-indexed predefined allow, and defaults get labelled", () => {
    const zoneDefault = {
      name: "Allow All Traffic",
      index: 1,
      predefined: true,
      action: "ALLOW",
      source: { zone_id: "zh", matching_target: "ANY" },
      destination: { zone_id: "zi", matching_target: "ANY" },
    };
    const customBlock = {
      name: "Portal: Block Guest",
      index: 10000,
      action: "BLOCK",
      source: { zone_id: "zh", matching_target: "ANY" },
      destination: { zone_id: "zi", matching_target: "ANY" },
    };
    const blocked = testFirewallPath({
      srcIp: "10.91.0.9",
      dstIp: "10.90.0.5",
      networks: nets,
      zones,
      policies: [zoneDefault, customBlock],
      rules: null,
    });
    assert.equal(blocked.verdict, "blocked");
    assert.equal(blocked.matched!.name, "Portal: Block Guest");

    const viaDefault = testFirewallPath({
      srcIp: "10.91.0.9",
      dstIp: "10.90.0.5",
      networks: nets,
      zones,
      policies: [zoneDefault],
      rules: null,
    });
    assert.equal(viaDefault.verdict, "allowed");
    assert.match(viaDefault.matched!.name, /\(zone default\)$/);
  });
});
