import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PlanNetwork } from "./firewallPlan.ts"; // explicit extension for Node's type-stripping runner
import type { ZbfZone } from "./zbfPlan.ts";
import type { LiveZbfPolicy } from "./pciCheck.ts";
import { assessDeletion } from "./policyCleanup.ts";

const corp: PlanNetwork = { id: "c1", name: "Corp", vlan: 10, subnet: "10.90.0.0/24", isGuest: false };
const guest: PlanNetwork = { id: "g1", name: "Guest", vlan: 40, subnet: "10.91.0.0/24", isGuest: true };
const nets = [corp, guest];
const internal: ZbfZone = { id: "zi", name: "Internal", networkIds: ["c1"] };
const hotspot: ZbfZone = { id: "zh", name: "Hotspot", networkIds: ["g1"] };
const zones = [internal, hotspot];

const allowGuestPortal: LiveZbfPolicy & { _id: string } = {
  _id: "a1",
  name: "Portal: Allow zone Hotspot → Portal :80",
  index: 10000,
  action: "ALLOW",
  source: { zone_id: "zh", matching_target: "ANY" },
  destination: { zone_id: "zi", matching_target: "IP", ips: ["10.90.0.232"], port: "80" },
};
const isolateGuest: LiveZbfPolicy & { _id: string } = {
  _id: "b1",
  name: "Portal: Isolate zone Hotspot — block traffic to zone Internal",
  index: 10001,
  action: "BLOCK",
  source: { zone_id: "zh", matching_target: "ANY" },
  destination: { zone_id: "zi", matching_target: "ANY" },
};

const idOf = (p: { _id?: string }) => p._id;

describe("assessDeletion (zone-based)", () => {
  it("refuses deleting the allow that shields the admin from a remaining block", () => {
    const a = assessDeletion({
      live: { policies: [allowGuestPortal, isolateGuest], rules: null },
      deletedIds: new Set(["a1"]),
      idOf,
      adminIp: "10.91.0.20",
      targetIps: ["10.90.0.232"],
      networks: nets,
      zones,
    });
    assert.equal(a.blocked, true);
    assert.match(a.warnings.join(" "), /REFUSED/);
  });

  it("allows deleting a block outright", () => {
    const a = assessDeletion({
      live: { policies: [allowGuestPortal, isolateGuest], rules: null },
      deletedIds: new Set(["b1"]),
      idOf,
      adminIp: "10.91.0.20",
      targetIps: ["10.90.0.232"],
      networks: nets,
      zones,
    });
    assert.equal(a.blocked, false);
  });

  it("warns when a deleted allow's flow lands on a remaining block (non-admin flow)", () => {
    const a = assessDeletion({
      live: { policies: [allowGuestPortal, isolateGuest], rules: null },
      deletedIds: new Set(["a1"]),
      idOf,
      adminIp: "10.90.0.50", // admin sits outside the guest zone
      targetIps: ["10.90.0.232"],
      networks: nets,
      zones,
    });
    assert.equal(a.blocked, false);
    assert.match(a.warnings.join(" "), /hands its traffic to remaining block/);
  });
});

describe("assessDeletion (classic)", () => {
  it("refuses when a remaining drop covers the admin with no accept left", () => {
    const a = assessDeletion({
      live: {
        policies: null,
        rules: [
          { _id: "a1", name: "Portal: Allow Guest → Portal :80", rule_index: 2000, action: "accept", src_address: "10.91.0.0/24", dst_address: "10.90.0.232" },
          { _id: "b1", name: "Portal: Isolate Guest", rule_index: 2001, action: "drop", src_address: "10.91.0.0/24", dst_address: "10.90.0.0/24" },
        ],
      },
      deletedIds: new Set(["a1"]),
      idOf,
      adminIp: "10.91.0.20",
      targetIps: ["10.90.0.232"],
      networks: nets,
      zones: null,
    });
    assert.equal(a.blocked, true);
  });
});
