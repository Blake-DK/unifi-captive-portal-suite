import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PlanNetwork } from "./firewallPlan.ts"; // explicit extension for Node's type-stripping runner
import type { ZbfZone } from "./zbfPlan.ts";
import { checkPciSegmentation, planPciFixes, type LiveZbfPolicy } from "./pciCheck.ts";

const pos: PlanNetwork = { id: "p1", name: "POS", vlan: 50, subnet: "10.0.50.0/24", isGuest: false };
const corp: PlanNetwork = { id: "c1", name: "Corp", vlan: 10, subnet: "10.90.0.0/24", isGuest: false };
const guest: PlanNetwork = { id: "g1", name: "Guest", vlan: 40, subnet: "10.91.0.0/24", isGuest: true };
const nets = [pos, corp, guest];

const posZone: ZbfZone = { id: "zp", name: "Payments", networkIds: ["p1"] };
const internal: ZbfZone = { id: "zi", name: "Internal", networkIds: ["c1"] };
const hotspot: ZbfZone = { id: "zh", name: "Hotspot", networkIds: ["g1"] };
const zones = [posZone, internal, hotspot];

const ep = (zone: string, extra: Record<string, unknown> = {}) => ({
  zone_id: zone,
  matching_target: "ANY",
  ...extra,
});

const zbfInput = (policies: LiveZbfPolicy[], pciZones = zones) => ({
  pciNetworkIds: ["p1"],
  networks: nets,
  zones: pciZones,
  policies,
  rules: null,
});

const rowIds = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("checkPciSegmentation (zone-based)", () => {
  it("passes a dedicated zone and flags zone-mixing as fail", () => {
    const dedicated = checkPciSegmentation(zbfInput([]));
    assert.ok(rowIds(dedicated).includes("zone-ok-p1"));

    const mixedZones: ZbfZone[] = [
      { id: "zp", name: "Payments", networkIds: ["p1", "c1"] },
      hotspot,
    ];
    const mixed = checkPciSegmentation(zbfInput([], mixedZones));
    assert.ok(rowIds(mixed).includes("zone-mixed-p1"));
    assert.equal(mixed.find((r) => r.id === "zone-mixed-p1")!.severity, "fail");
  });

  it("fails on a broad allow into the PCI network", () => {
    const rows = checkPciSegmentation(
      zbfInput([
        { name: "wide open", index: 1, action: "ALLOW", source: ep("zh"), destination: ep("zp") },
      ]),
    );
    const fail = rows.find((r) => r.id === "in-broad-p1")!;
    assert.equal(fail.severity, "fail");
    assert.equal(fail.evidence, "wide open");
  });

  it("treats port-restricted allows as enumerated exceptions (info)", () => {
    const rows = checkPciSegmentation(
      zbfInput([
        {
          name: "corp to pos api",
          index: 1,
          action: "ALLOW",
          source: ep("zi"),
          destination: ep("zp", { port_matching_type: "SPECIFIC", port: "443" }),
        },
        { name: "guests blocked", index: 2, action: "BLOCK", source: ep("zh"), destination: ep("zp") },
      ]),
    );
    assert.ok(rowIds(rows).includes("in-narrow-p1"));
    assert.ok(rowIds(rows).includes("in-blocked-p1"));
    assert.ok(!rowIds(rows).includes("in-broad-p1"));
  });

  it("first match wins: a block above an allow still passes", () => {
    const rows = checkPciSegmentation(
      zbfInput([
        { name: "block first", index: 1, action: "BLOCK", source: ep("zh"), destination: ep("zp") },
        { name: "allow below", index: 2, action: "ALLOW", source: ep("zh"), destination: ep("zp") },
        { name: "corp block", index: 3, action: "BLOCK", source: ep("zi"), destination: ep("zp") },
      ]),
    );
    assert.ok(!rowIds(rows).includes("in-broad-p1"));
    assert.equal(rows.find((r) => r.id === "in-blocked-p1")!.severity, "pass");
  });

  it("warns when flows fall through to the zone-matrix default", () => {
    const rows = checkPciSegmentation(zbfInput([]));
    const warn = rows.find((r) => r.id === "in-default-p1")!;
    assert.equal(warn.severity, "warn");
    assert.match(warn.title, /Corp|Guest/);
  });

  it("warns on unrestricted egress from the PCI network", () => {
    const rows = checkPciSegmentation(
      zbfInput([
        { name: "pos out", index: 1, action: "ALLOW", source: ep("zp"), destination: ep("zi") },
      ]),
    );
    assert.equal(rows.find((r) => r.id === "out-broad-p1")!.severity, "warn");
  });

  it("ignores disabled policies", () => {
    const rows = checkPciSegmentation(
      zbfInput([
        { name: "off", index: 1, enabled: false, action: "ALLOW", source: ep("zh"), destination: ep("zp") },
      ]),
    );
    assert.ok(!rowIds(rows).includes("in-broad-p1"));
  });

  it("returns nothing when no PCI networks are marked", () => {
    assert.deepEqual(
      checkPciSegmentation({ pciNetworkIds: [], networks: nets, zones, policies: [], rules: null }),
      [],
    );
  });
});

describe("checkPciSegmentation (classic)", () => {
  it("passes explicit drops and fails broad accepts", () => {
    const rows = checkPciSegmentation({
      pciNetworkIds: ["p1"],
      networks: nets,
      zones: null,
      policies: null,
      rules: [
        { name: "guest drop", rule_index: 2000, action: "drop", src_address: "10.91.0.0/24", dst_address: "10.0.50.0/24" },
        { name: "corp wide", rule_index: 2001, action: "accept", src_address: "10.90.0.0/24", dst_address: "10.0.50.0/24" },
      ],
    });
    assert.ok(rowIds(rows).includes("in-blocked-p1"));
    const fail = rows.find((r) => r.id === "in-broad-p1")!;
    assert.equal(fail.evidence, "corp wide");
  });
});

describe("planPciFixes", () => {
  it("plans explicit blocks for default-fallthrough flows, both directions", () => {
    const fix = planPciFixes(zbfInput([]));
    // Corp↔POS and Guest↔POS, both directions = 4 blocks
    assert.equal(fix.policies.length, 4);
    assert.ok(fix.policies.every((p) => p.action === "BLOCK" && p.protocol === "all"));
    const inbound = fix.policies.find((p) => p.name === "Block Corp → PCI POS")!;
    assert.deepEqual(inbound.source.networkIds, ["c1"]);
    assert.deepEqual(inbound.destination.networkIds, ["p1"]);
    assert.equal(inbound.destination.zoneId, "zp");
    assert.ok(fix.policies.some((p) => p.name === "Block PCI POS → Guest"));
  });

  it("does not plan blocks for flows that already have an explicit policy", () => {
    const fix = planPciFixes(
      zbfInput([
        { name: "guests blocked", index: 1, action: "BLOCK", source: ep("zh"), destination: ep("zp") },
      ]),
    );
    assert.ok(!fix.policies.some((p) => p.name.includes("Guest → PCI")));
    assert.ok(fix.policies.some((p) => p.name === "Block Corp → PCI POS"));
  });

  it("reports broad allows and zone-mixing as unfixable instead of planning around them", () => {
    const mixedZones: ZbfZone[] = [
      { id: "zp", name: "Payments", networkIds: ["p1", "c1"] },
      hotspot,
    ];
    const broad = planPciFixes(
      zbfInput([
        { name: "wide open", index: 1, action: "ALLOW", source: ep("zh"), destination: ep("zp") },
      ]),
    );
    assert.match(broad.unfixable.join(" "), /wide open/);
    assert.ok(!broad.policies.some((p) => p.name.includes("Guest → PCI")));

    const mixed = planPciFixes(zbfInput([], mixedZones));
    assert.match(mixed.unfixable.join(" "), /shares zone/);
    // Roommate flows (Corp) get no policy; Guest still does.
    assert.ok(!mixed.policies.some((p) => p.name.includes("Corp")));
    assert.ok(mixed.policies.some((p) => p.name.includes("Guest")));
  });

  it("plans classic drops on the right rulesets", () => {
    const fix = planPciFixes({
      pciNetworkIds: ["p1"],
      networks: nets,
      zones: null,
      policies: null,
      rules: [],
    });
    const guestIn = fix.rules.find((r) => r.description === "Block Guest → PCI POS")!;
    assert.equal(guestIn.ruleset, "GUEST_IN");
    const egress = fix.rules.find((r) => r.description === "Block PCI POS → Corp")!;
    assert.equal(egress.ruleset, "LAN_IN");
    assert.ok(fix.rules.every((r) => r.action === "drop" && r.protocol === "all"));
  });
});

describe("predefined zone-matrix defaults", () => {
  const zoneDefault = {
    name: "Allow All Traffic",
    index: 1, // real controllers give defaults LOW indexes — order must ignore that
    predefined: true,
    action: "ALLOW",
    source: ep("zh"),
    destination: ep("zp"),
  };

  it("custom policies outrank a lower-indexed predefined default in the walk", () => {
    const rows = checkPciSegmentation(
      zbfInput([
        zoneDefault,
        { name: "guests blocked", index: 10000, action: "BLOCK", source: ep("zh"), destination: ep("zp") },
      ]),
    );
    assert.ok(rowIds(rows).includes("in-blocked-p1"));
    assert.ok(!rowIds(rows).includes("in-zonedefault-p1"));
  });

  it("flags flows open only via the zone default as their own fixable row", () => {
    const rows = checkPciSegmentation(zbfInput([zoneDefault]));
    const row = rows.find((r) => r.id === "in-zonedefault-p1")!;
    assert.equal(row.severity, "fail");
    assert.match(row.detail, /Zone Matrix/);
    assert.ok(!rowIds(rows).includes("in-broad-p1"));
  });

  it("planPciFixes blocks zone-default flows and notes the matrix flip", () => {
    const fix = planPciFixes(zbfInput([zoneDefault]));
    assert.ok(fix.policies.some((p) => p.name === "Block Guest → PCI POS"));
    assert.ok(!fix.unfixable.some((u) => u.includes("Allow All Traffic")));
    assert.match(fix.notes.join(" "), /Zone Matrix/);
  });

  it("still refuses to fix around a CUSTOM broad allow", () => {
    const fix = planPciFixes(
      zbfInput([{ name: "hand-made wide", index: 5, action: "ALLOW", source: ep("zh"), destination: ep("zp") }]),
    );
    assert.ok(!fix.policies.some((p) => p.name.includes("Guest → PCI")));
    assert.match(fix.unfixable.join(" "), /hand-made wide/);
  });
});
