import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assessCriticalAddresses,
  assessLockout,
  buildFirewallPlan,
  criticalSourceHits,
  ipInCidr,
  parseCriticalAddresses,
  portalRuleName,
  rangeOf,
  type PlanNetwork,
} from "./firewallPlan.ts"; // explicit extension for Node's type-stripping runner

const portal = { name: "Portal", ip: "10.90.0.232" };
const proxy = { name: "Traefik", ip: "10.90.0.189" };
const guest: PlanNetwork = { id: "g1", name: "Guest", vlan: 420, subnet: "10.91.0.0/21", isGuest: true };
const guest2: PlanNetwork = { id: "g2", name: "Events", vlan: 430, subnet: "10.91.8.0/24", isGuest: true };
const corp: PlanNetwork = { id: "c1", name: "Corp", vlan: 10, subnet: "10.90.0.0/24", isGuest: false };

describe("buildFirewallPlan", () => {
  it("emits accept rules per selected network × target", () => {
    const plan = buildFirewallPlan([guest], portal, proxy);
    const accepts = plan.rules.filter((r) => r.action === "accept");
    assert.equal(accepts.length, 2); // portal + proxy
    assert.deepEqual(
      accepts.map((r) => [r.ruleset, r.destination, r.ports]),
      [["GUEST_IN", "10.90.0.232", "80"], ["GUEST_IN", "10.90.0.189", "80, 443"]],
    );
    assert.ok(plan.rules.every((r) => r.source === "10.91.0.0/21"));
  });

  it("uses LAN_IN for non-guest networks", () => {
    const plan = buildFirewallPlan([corp], portal, null);
    assert.equal(plan.rules.length, 1);
    assert.equal(plan.rules[0].ruleset, "LAN_IN");
  });

  it("drops guest networks that were not selected", () => {
    const plan = buildFirewallPlan([guest], portal, null, [guest, guest2]);
    const drops = plan.rules.filter((r) => r.action === "drop");
    // guest2 not selected -> one drop to the portal
    assert.equal(drops.length, 1);
    assert.equal(drops[0].source, "10.91.8.0/24");
    assert.equal(drops[0].action, "drop");
  });

  it("orders rules sequentially, accepts before drops", () => {
    const plan = buildFirewallPlan([guest], portal, null, [guest, guest2]);
    assert.deepEqual(plan.rules.map((r) => r.order), [1, 2]);
    // accept (guest→portal) then drop (guest2→portal)
    assert.equal(plan.rules[0].action, "accept");
    assert.equal(plan.rules[1].action, "drop");
  });

  it("emits inter-VLAN isolation drops from every guest network to every other network", () => {
    const plan = buildFirewallPlan([guest], portal, null, [guest, guest2], [guest, guest2, corp]);
    const iso = plan.rules.filter((r) => r.description.startsWith("Isolate"));
    // guest → {guest2, corp} + guest2 → {guest, corp}
    assert.deepEqual(
      iso.map((r) => [r.source, r.destination]),
      [
        ["10.91.0.0/21", "10.91.8.0/24"],
        ["10.91.0.0/21", "10.90.0.0/24"],
        ["10.91.8.0/24", "10.91.0.0/21"],
        ["10.91.8.0/24", "10.90.0.0/24"],
      ],
    );
    assert.ok(iso.every((r) => r.action === "drop" && r.ruleset === "GUEST_IN" && r.protocol === "all"));
    // isolation drops come after the portal accepts
    const firstIso = plan.rules.findIndex((r) => r.description.startsWith("Isolate"));
    assert.ok(plan.rules.slice(0, firstIso).every((r) => !r.description.startsWith("Isolate")));
    assert.match(plan.notes.join(" "), /inter-VLAN/i);
  });

  it("notes a network without a subnet instead of emitting a broken rule", () => {
    const plan = buildFirewallPlan([{ id: "x", name: "NoSubnet", isGuest: true }], portal, null);
    assert.equal(plan.rules.length, 0);
    assert.match(plan.notes.join(" "), /no subnet/i);
  });

  it("bails with a note when the portal IP is not an IP", () => {
    const plan = buildFirewallPlan([guest], { name: "Portal", ip: "portal.example.com" }, null);
    assert.equal(plan.rules.length, 0);
    assert.match(plan.notes.join(" "), /not an IP/i);
  });

  it("keeps portal rules but notes a non-IP proxy address", () => {
    const plan = buildFirewallPlan([guest], portal, { name: "Traefik", ip: "proxy.example.com" });
    assert.ok(plan.rules.some((r) => r.destination === "10.90.0.232"));
    assert.ok(!plan.rules.some((r) => r.destination === "proxy.example.com"));
    assert.match(plan.notes.join(" "), /not an IP/i);
  });
});

describe("ipInCidr", () => {
  it("matches inside/outside and tolerates gateway-style CIDRs", () => {
    assert.equal(ipInCidr("10.90.0.55", "10.90.0.0/24"), true);
    assert.equal(ipInCidr("10.90.0.55", "10.90.0.1/24"), true); // UniFi ip_subnet form
    assert.equal(ipInCidr("10.0.11.55", "10.90.0.0/24"), false);
    assert.equal(ipInCidr("10.91.7.255", "10.91.0.0/21"), true);
    assert.equal(ipInCidr("10.91.8.1", "10.91.0.0/21"), false);
    assert.equal(ipInCidr("nonsense", "10.90.0.0/24"), false);
    assert.equal(ipInCidr("10.90.0.55", "not-a-cidr"), false);
  });
});

describe("assessLockout", () => {
  const targets = ["10.90.0.232"];

  it("blocks when the admin sits in a drop rule's source aimed at the portal", () => {
    const plan = buildFirewallPlan([], portal, null, [guest2], [guest2]);
    const a = assessLockout(plan.rules, "10.91.8.20", targets);
    assert.equal(a.blocked, true);
    assert.match(a.warnings.join(" "), /REFUSED/);
  });

  it("warns (not blocks) when the admin only loses inter-VLAN reach", () => {
    const plan = buildFirewallPlan([guest], portal, null, [guest], [guest, corp]);
    const a = assessLockout(plan.rules, "10.91.0.20", targets);
    assert.equal(a.blocked, false);
    assert.match(a.warnings.join(" "), /cut you off from 10\.90\.0\.0\/24/);
  });

  it("does not block when an accept above the drop keeps the admin's subnet on the portal", () => {
    const plan = buildFirewallPlan([guest], portal, null, [guest], [guest, corp]);
    // portal 10.90.0.232 sits inside corp's subnet, which the isolation drop
    // covers — but guest has an explicit accept to the portal above it.
    const a = assessLockout(plan.rules, "10.91.0.20", ["10.90.0.232"]);
    assert.equal(a.blocked, false);
  });

  it("blocks when an isolation drop reaches a target the admin has no accept for", () => {
    const plan = buildFirewallPlan([guest], portal, null, [guest], [guest, corp]);
    // 10.90.0.5 is inside the dropped corp subnet and no accept covers it.
    const a = assessLockout(plan.rules, "10.91.0.20", ["10.90.0.5"]);
    assert.equal(a.blocked, true);
  });

  it("passes cleanly for an admin outside every drop source", () => {
    const plan = buildFirewallPlan([guest], portal, null, [guest, guest2], [guest, guest2, corp]);
    const a = assessLockout(plan.rules, "10.90.0.50", ["10.90.0.232"]);
    assert.equal(a.blocked, false);
    assert.match(a.warnings.join(" "), /Lockout check passed/);
  });

  it("warns and does not vouch when the admin IP is unknown", () => {
    const a = assessLockout([], null, targets);
    assert.equal(a.blocked, false);
    assert.match(a.warnings.join(" "), /could not be determined/i);
  });
});

describe("parseCriticalAddresses / rangeOf", () => {
  it("accepts IPs and CIDRs, rejects junk", () => {
    const { entries, invalid } = parseCriticalAddresses("10.0.20.5, 10.0.30.0/24 bogus 300.1.1.1");
    assert.deepEqual(entries.map((e) => e.raw), ["10.0.20.5", "10.0.30.0/24"]);
    assert.deepEqual(invalid, ["bogus", "300.1.1.1"]);
  });

  it("normalizes a CIDR to its network range", () => {
    const r = rangeOf("10.0.30.77/24")!;
    assert.equal(r.hi - r.lo, 255);
  });
});

describe("assessCriticalAddresses", () => {
  const entriesOf = (text: string) => parseCriticalAddresses(text).entries;

  it("refuses when a drop's source covers a critical address", () => {
    // Critical device inside the isolated guest subnet.
    const plan = buildFirewallPlan([], portal, null, [guest], [guest, corp]);
    const a = assessCriticalAddresses(plan.rules, entriesOf("10.91.0.9"));
    assert.equal(a.blocked, true);
    assert.equal(a.verdicts[0].status, "cut-off");
  });

  it("warns (not refuses) when drops merely point AT a critical address", () => {
    const plan = buildFirewallPlan([], portal, null, [guest], [guest, corp]);
    // corp subnet is an isolation-drop destination.
    const a = assessCriticalAddresses(plan.rules, entriesOf("10.90.0.7"));
    assert.equal(a.blocked, false);
    assert.equal(a.verdicts[0].status, "blocked-to");
  });

  it("marks untouched addresses safe", () => {
    const plan = buildFirewallPlan([guest], portal, null, [guest], [guest]);
    const a = assessCriticalAddresses(plan.rules, entriesOf("172.16.0.1"));
    assert.equal(a.blocked, false);
    assert.equal(a.verdicts[0].status, "safe");
  });

  it("judges CIDR entries by overlap", () => {
    const plan = buildFirewallPlan([], portal, null, [guest], [guest, corp]);
    const a = assessCriticalAddresses(plan.rules, entriesOf("10.91.0.0/26"));
    assert.equal(a.blocked, true);
  });
});

describe("criticalSourceHits", () => {
  const entriesOf = (text: string) => parseCriticalAddresses(text).entries;

  it("lists, per rule, the critical entries a drop's source covers", () => {
    const plan = buildFirewallPlan([], portal, null, [guest], [guest, corp]);
    const hits = criticalSourceHits(plan.rules, entriesOf("10.91.0.9"));
    assert.equal(hits.length, plan.rules.length);
    plan.rules.forEach((r, i) => {
      assert.deepEqual(hits[i], r.action === "drop" && r.source === guest.subnet ? ["10.91.0.9"] : []);
    });
  });

  it("keeps every hit list empty when drops merely point AT the address", () => {
    const plan = buildFirewallPlan([], portal, null, [guest], [guest, corp]);
    const hits = criticalSourceHits(plan.rules, entriesOf("10.90.0.7"));
    assert.ok(hits.every((h) => h.length === 0));
  });
});

describe("portalRuleName", () => {
  it("prefixes, suffixes the port, and stays within 64 chars", () => {
    assert.equal(portalRuleName("Allow Guest → Portal", "80"), "Portal: Allow Guest → Portal :80");
    assert.ok(portalRuleName("x".repeat(100), "443").length <= 64);
  });
});

describe("critical allows (classic) and @ parsing", () => {
  it("parses @all, service tokens with protocol suffixes, and ping; rejects bad specs", () => {
    const { entries, invalid } = parseCriticalAddresses(
      "10.0.20.5@53+123u+ping, 10.0.20.6@all, 10.0.20.7@x, 10.0.20.8, 10.0.20.9@22t",
    );
    assert.deepEqual(entries.map((e) => [e.addr, e.allow]), [
      ["10.0.20.5", { services: [{ port: "53", proto: "tcp_udp" }, { port: "123", proto: "udp" }], ping: true }],
      ["10.0.20.6", "all"],
      ["10.0.20.8", null],
      ["10.0.20.9", { services: [{ port: "22", proto: "tcp" }], ping: false }],
    ]);
    assert.deepEqual(invalid, ["10.0.20.7@x"]);
  });

  it("emits accepts above the drops: one per guest network × service, plus ICMP for ping", () => {
    const { entries } = parseCriticalAddresses("10.90.0.7@53+123u+ping");
    const plan = buildFirewallPlan([], portal, null, [guest, guest2], [guest, guest2, corp], entries);
    const accepts = plan.rules.filter((r) => r.description.includes("critical 10.90.0.7"));
    // 2 guest networks × (53 tcp_udp + 123 udp + ping icmp)
    assert.equal(accepts.length, 6);
    const forGuest = accepts.filter((r) => r.source === guest.subnet);
    assert.deepEqual(
      forGuest.map((r) => [r.protocol, r.ports]),
      [["tcp_udp", "53"], ["udp", "123"], ["icmp", "-"]],
    );
    assert.match(forGuest[2].description, /\(ping\)/);
    const firstDrop = plan.rules.findIndex((r) => r.action === "drop");
    assert.ok(plan.rules.indexOf(accepts[0]) < firstDrop);
  });

  it("assessment turns blocked-to into safe when an @all allow shields the entry", () => {
    const { entries } = parseCriticalAddresses("10.90.0.7@all");
    const plan = buildFirewallPlan([], portal, null, [guest], [guest, corp], entries);
    const a = assessCriticalAddresses(plan.rules, entries);
    assert.equal(a.verdicts[0].status, "safe");
    assert.match(a.verdicts[0].detail, /Allowed above the blocks/);
  });
});

describe("assessLockout internet-side admins", () => {
  it("mentions the internet path for a public admin IP", () => {
    const plan = buildFirewallPlan([guest], portal, null, [guest], [guest, corp]);
    const a = assessLockout(plan.rules, "154.62.191.142", ["10.90.0.232"]);
    assert.equal(a.blocked, false);
    assert.match(a.warnings.join(" "), /internet/);
  });
});
