import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PlanNetwork } from "./firewallPlan.ts"; // explicit extension for Node's type-stripping runner
import {
  assessZbfCritical,
  assessZbfLockout,
  buildZbfPlan,
  policyPayload,
  zbfCriticalSourceHits,
  type ZbfZone,
} from "./zbfPlan.ts";

const portal = { name: "Portal", ip: "10.90.0.232" };
const proxySameIp = { name: "Traefik", ip: "10.90.0.232" };
const proxyOther = { name: "Traefik", ip: "10.90.0.189" };

const corp: PlanNetwork = { id: "c1", name: "Corp", vlan: 10, subnet: "10.90.0.0/24", isGuest: false };
const mgmt: PlanNetwork = { id: "m1", name: "Mgmt", vlan: 20, subnet: "10.0.20.0/24", isGuest: false };
const guest: PlanNetwork = { id: "g1", name: "Guest", vlan: 420, subnet: "10.91.0.0/21", isGuest: true };
const guest2: PlanNetwork = { id: "g2", name: "Events", vlan: 430, subnet: "10.91.8.0/24", isGuest: true };

const internal: ZbfZone = { id: "z1", name: "Internal", networkIds: ["c1", "m1"] };
const hotspot: ZbfZone = { id: "z2", name: "Hotspot", networkIds: ["g1", "g2"] };
const zones = [internal, hotspot];
const nets = [corp, mgmt, guest, guest2];

describe("buildZbfPlan", () => {
  it("merges the bundled proxy (same IP) into one target on ports 80+443", () => {
    const plan = buildZbfPlan([guest, guest2], portal, proxySameIp, nets, zones);
    const allows = plan.policies.filter((p) => p.action === "ALLOW");
    assert.equal(allows.length, 2); // one source group × ports 80, 443
    assert.deepEqual(allows.map((p) => p.destination.port), ["80", "443"]);
    assert.ok(allows.every((p) => p.destination.ip === portal.ip));
    assert.match(allows[0].name, /via Traefik/);
  });

  it("keeps a distinct proxy IP as its own target", () => {
    const plan = buildZbfPlan([guest, guest2], portal, proxyOther, nets, zones);
    const allows = plan.policies.filter((p) => p.action === "ALLOW");
    // portal :80 + proxy :80/:443
    assert.deepEqual(
      allows.map((p) => [p.destination.ip, p.destination.port]),
      [["10.90.0.232", "80"], ["10.90.0.189", "80"], ["10.90.0.189", "443"]],
    );
  });

  it("matches the whole zone when every network in it is selected", () => {
    const plan = buildZbfPlan([guest, guest2], portal, null, nets, zones);
    const allow = plan.policies.find((p) => p.action === "ALLOW")!;
    assert.equal(allow.source.networkIds, null);
    assert.equal(allow.source.zoneId, "z2");
    assert.match(allow.source.label, /zone “Hotspot”/);
  });

  it("matches specific networks when only part of the zone is selected", () => {
    const plan = buildZbfPlan([guest], portal, null, nets, zones);
    const allow = plan.policies.find((p) => p.action === "ALLOW")!;
    assert.deepEqual(allow.source.networkIds, ["g1"]);
    assert.equal(allow.source.label, "Guest");
  });

  it("blocks unticked guest networks to each target, below the allows", () => {
    const plan = buildZbfPlan([guest], portal, null, nets, zones);
    const block = plan.policies.find((p) => p.name.startsWith("Block"))!;
    assert.equal(block.action, "BLOCK");
    assert.equal(block.protocol, "all");
    assert.deepEqual(block.source.networkIds, ["g2"]);
    assert.equal(block.destination.ip, portal.ip);
    assert.equal(block.destination.port, null);
    const firstBlock = plan.policies.findIndex((p) => p.action === "BLOCK");
    assert.ok(plan.policies.slice(0, firstBlock).every((p) => p.action === "ALLOW"));
  });

  it("allows cross-zone DHCP DNS servers on :53 so isolation doesn't break resolution", () => {
    // Both guest networks hand out the same internal DNS (in mgmt, zone
    // Internal) plus a public resolver and their own gateway.
    const g1 = { ...guest, dnsServers: ["10.0.20.5", "8.8.8.8"] };
    const g2 = { ...guest2, dnsServers: ["10.0.20.5", "10.91.8.1"] };
    const plan = buildZbfPlan([g1, g2], portal, null, [corp, mgmt, g1, g2], zones);
    const dns = plan.policies.filter((p) => p.name.includes("DNS"));
    // Deduped to ONE policy: same source zone, same server. The public
    // resolver (no zone) and the own-gateway entry (same zone) emit nothing.
    assert.equal(dns.length, 1);
    assert.equal(dns[0].action, "ALLOW");
    assert.equal(dns[0].protocol, "tcp_udp");
    assert.equal(dns[0].source.zoneId, "z2");
    assert.deepEqual([dns[0].destination.ip, dns[0].destination.port, dns[0].destination.zoneId], ["10.0.20.5", "53", "z1"]);
    // Above the isolation blocks.
    const firstBlock = plan.policies.findIndex((p) => p.action === "BLOCK");
    assert.ok(plan.policies.indexOf(dns[0]) < firstBlock);
  });

  it("emits DNS allows even for guest zones with nothing ticked", () => {
    const g2 = { ...guest2, dnsServers: ["10.0.20.5"] };
    const plan = buildZbfPlan([], portal, null, [corp, mgmt, guest, g2], zones);
    assert.ok(plan.policies.some((p) => p.name.includes("DNS 10.0.20.5")));
  });

  it("isolates a pure guest zone from every other zone with networks", () => {
    const plan = buildZbfPlan([guest, guest2], portal, null, nets, zones);
    const iso = plan.policies.filter((p) => p.name.startsWith("Isolate"));
    assert.equal(iso.length, 1); // Hotspot → Internal
    assert.equal(iso[0].source.zoneId, "z2");
    assert.equal(iso[0].source.networkIds, null);
    assert.equal(iso[0].destination.zoneId, "z1");
    assert.equal(iso[0].destination.ip, null);
    assert.match(plan.notes.join(" "), /block Hotspot→Internal traffic by default/);
  });

  it("flags a zone mixing guest and non-guest networks and falls back to network matching", () => {
    const mixedGuest: PlanNetwork = { id: "g3", name: "Lobby", subnet: "10.0.30.0/24", isGuest: true };
    const mixedZones: ZbfZone[] = [
      { id: "z1", name: "Internal", networkIds: ["c1", "m1", "g3"] },
      hotspot,
    ];
    const plan = buildZbfPlan([], portal, null, [...nets, mixedGuest], mixedZones);
    assert.match(plan.notes.join(" "), /mixes guest \(Lobby\) and non-guest \(Corp, Mgmt\)/);
    const iso = plan.policies.filter((p) => p.name.startsWith("Isolate") && p.source.zoneId === "z1");
    assert.ok(iso.length > 0);
    assert.deepEqual(iso[0].source.networkIds, ["g3"]);
  });

  it("bails with a note when the portal IP is not inside any zoned network", () => {
    const plan = buildZbfPlan([guest], { name: "Portal", ip: "172.16.0.9" }, null, nets, zones);
    assert.equal(plan.policies.length, 0);
    assert.match(plan.notes.join(" "), /not inside any network that belongs to a firewall zone/);
  });

  it("bails with a note when the portal address is not an IP", () => {
    const plan = buildZbfPlan([guest], { name: "Portal", ip: "portal.example.com" }, null, nets, zones);
    assert.equal(plan.policies.length, 0);
    assert.match(plan.notes.join(" "), /not an IP/);
  });

  it("notes a selected network that belongs to no zone instead of emitting a policy", () => {
    const orphan: PlanNetwork = { id: "x1", name: "Orphan", subnet: "10.0.40.0/24", isGuest: false };
    const plan = buildZbfPlan([orphan], portal, null, [...nets, orphan], zones);
    assert.ok(!plan.policies.some((p) => p.source.networkIds?.includes("x1")));
    assert.match(plan.notes.join(" "), /not assigned to any firewall zone/);
  });
});

describe("policyPayload", () => {
  it("renders whole-zone sources as ANY and network subsets as NETWORK", () => {
    const plan = buildZbfPlan([guest], portal, null, nets, zones);
    const allow = plan.policies.find((p) => p.action === "ALLOW")!;
    const payload = policyPayload(allow, 10000, "Portal: test") as {
      source: Record<string, unknown>;
      destination: Record<string, unknown>;
      index: number;
      name: string;
      action: string;
    };
    assert.equal(payload.index, 10000);
    assert.equal(payload.name, "Portal: test");
    assert.equal(payload.action, "ALLOW");
    assert.equal(payload.source.matching_target, "NETWORK");
    assert.equal(payload.source.matching_target_type, "SPECIFIC");
    assert.deepEqual(payload.source.network_ids, ["g1"]);
    assert.equal(payload.source.port_matching_type, "ANY");
    assert.equal(payload.destination.matching_target, "IP");
    assert.equal(payload.destination.matching_target_type, "SPECIFIC");
    assert.deepEqual(payload.destination.ips, ["10.90.0.232"]);
    assert.equal(payload.destination.port_matching_type, "SPECIFIC");
    assert.equal(payload.destination.port, "80");

    const iso = buildZbfPlan([guest, guest2], portal, null, nets, zones).policies.find((p) =>
      p.name.startsWith("Isolate"),
    )!;
    // ALLOWs omit create_allow_respond (creates fine, server default applies).
    assert.ok(!("create_allow_respond" in payload));

    const isoPayload = policyPayload(iso, 10001, "Portal: iso") as {
      source: Record<string, unknown>;
      destination: Record<string, unknown>;
      create_allow_respond?: boolean;
    };
    // BLOCKs must switch respond-traffic off explicitly — the server default
    // is ON and a BLOCK with it is rejected.
    assert.equal(isoPayload.create_allow_respond, false);
    assert.equal(isoPayload.source.matching_target, "ANY");
    assert.equal(isoPayload.source.matching_target_type, undefined);
    assert.equal(isoPayload.source.network_ids, undefined);
    assert.equal(isoPayload.destination.matching_target, "ANY");
    assert.equal(isoPayload.destination.matching_target_type, undefined);
    assert.equal(isoPayload.destination.port_matching_type, "ANY");
  });
});

describe("assessZbfLockout", () => {
  const targets = ["10.90.0.232"];

  it("blocks when the admin sits in an unticked guest network aimed away from the portal", () => {
    const plan = buildZbfPlan([guest], portal, null, nets, zones);
    const a = assessZbfLockout(plan.policies, "10.91.8.20", nets, zones, targets);
    assert.equal(a.blocked, true);
    assert.match(a.warnings.join(" "), /REFUSED/);
  });

  it("does not block an admin in a selected network — the ALLOW above protects the portal", () => {
    const plan = buildZbfPlan([guest], portal, null, nets, zones);
    const a = assessZbfLockout(plan.policies, "10.91.0.20", nets, zones, targets);
    assert.equal(a.blocked, false);
    // The zone-wide isolation still costs the admin the Internal zone.
    assert.match(a.warnings.join(" "), /cut you off from zone “Internal”/);
  });

  it("blocks when a zone-wide isolation reaches the portal's zone and no ALLOW covers the admin", () => {
    // Nothing selected: guests get no ALLOW; isolation Hotspot→Internal covers the portal.
    const plan = buildZbfPlan([], portal, null, nets, zones);
    const a = assessZbfLockout(plan.policies, "10.91.0.20", nets, zones, targets);
    assert.equal(a.blocked, true);
  });

  it("passes cleanly for an admin outside every BLOCK source", () => {
    const plan = buildZbfPlan([guest], portal, null, nets, zones);
    const a = assessZbfLockout(plan.policies, "10.90.0.50", nets, zones, targets);
    assert.equal(a.blocked, false);
    assert.match(a.warnings.join(" "), /Lockout check passed/);
  });

  it("cannot vouch for an admin IP outside every zoned network", () => {
    const plan = buildZbfPlan([guest], portal, null, nets, zones);
    const a = assessZbfLockout(plan.policies, "172.16.5.5", nets, zones, targets);
    assert.equal(a.blocked, false);
    assert.match(a.warnings.join(" "), /not inside any zoned network/);
  });

  it("warns and does not vouch when the admin IP is unknown", () => {
    const a = assessZbfLockout([], null, nets, zones, targets);
    assert.equal(a.blocked, false);
    assert.match(a.warnings.join(" "), /could not be determined/i);
  });
});

describe("assessZbfCritical", () => {
  const entriesOf = (text: string) =>
    text.split(",").map((raw) => {
      const [ip, bits] = raw.trim().split("/");
      const n = ip.split(".").map(Number);
      const int = n[0] * 2 ** 24 + n[1] * 2 ** 16 + n[2] * 256 + n[3];
      const allow = null;
      if (!bits) return { raw: raw.trim(), addr: raw.trim(), lo: int, hi: int, allow };
      const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
      const lo = (int & mask) >>> 0;
      return {
        raw: raw.trim(),
        addr: raw.trim(),
        lo,
        hi: (lo + (2 ** (32 - Number(bits)) - 1)) >>> 0,
        allow,
      };
    });

  it("refuses when an isolation block's source zone holds the critical address", () => {
    const plan = buildZbfPlan([guest, guest2], portal, null, nets, zones);
    // 10.91.0.9 sits in Guest (zone Hotspot) — the Isolate blocks source it.
    const a = assessZbfCritical(plan.policies, entriesOf("10.91.0.9"), nets, zones);
    assert.equal(a.blocked, true);
    assert.equal(a.verdicts[0].status, "cut-off");
  });

  it("warns when blocks merely point at the critical address's zone", () => {
    const plan = buildZbfPlan([guest, guest2], portal, null, nets, zones);
    // 10.0.20.7 is in Mgmt (zone Internal) — isolation blocks target that zone.
    const a = assessZbfCritical(plan.policies, entriesOf("10.0.20.7"), nets, zones);
    assert.equal(a.blocked, false);
    assert.equal(a.verdicts[0].status, "blocked-to");
  });

  it("marks addresses outside every endpoint safe", () => {
    const plan = buildZbfPlan([guest, guest2], portal, null, nets, zones);
    const a = assessZbfCritical(plan.policies, entriesOf("172.16.1.1"), nets, zones);
    assert.equal(a.verdicts[0].status, "safe");
  });
});

describe("zbfCriticalSourceHits", () => {
  const entriesOf = (text: string) =>
    text.split(",").map((raw) => {
      const n = raw.trim().split(".").map(Number);
      const int = n[0] * 2 ** 24 + n[1] * 2 ** 16 + n[2] * 256 + n[3];
      return { raw: raw.trim(), addr: raw.trim(), lo: int, hi: int, allow: null };
    });

  it("lists, per policy, the critical entries its block's source covers", () => {
    const plan = buildZbfPlan([guest, guest2], portal, null, nets, zones);
    const hits = zbfCriticalSourceHits(plan.policies, entriesOf("10.91.0.9"), nets, zones);
    assert.equal(hits.length, plan.policies.length);
    plan.policies.forEach((p, i) => {
      if (p.action === "ALLOW") assert.deepEqual(hits[i], []);
    });
    assert.ok(plan.policies.some((p, i) => p.action === "BLOCK" && hits[i].includes("10.91.0.9")));
  });

  it("keeps every hit list empty when blocks merely target the critical zone", () => {
    const plan = buildZbfPlan([guest, guest2], portal, null, nets, zones);
    const hits = zbfCriticalSourceHits(plan.policies, entriesOf("10.0.20.7"), nets, zones);
    assert.ok(hits.every((h) => h.length === 0));
  });
});

describe("buildZbfPlan critical allows", () => {
  type Allow = null | "all" | { services: { port: string; proto: "tcp" | "udp" | "tcp_udp" }[]; ping: boolean };
  const ipInt = (ip: string) => {
    const n = ip.split(".").map(Number);
    return n[0] * 2 ** 24 + n[1] * 2 ** 16 + n[2] * 256 + n[3];
  };
  const critical = (raw: string, addr: string, allow: Allow) =>
    ({ raw, addr, allow, lo: ipInt(addr), hi: ipInt(addr) });
  const dns = critical("10.0.20.5@53", "10.0.20.5", { services: [{ port: "53", proto: "tcp_udp" }], ping: false });
  const dhcp = critical("10.0.20.6@all", "10.0.20.6", "all");

  it("emits per-port tcp_udp allows above the isolation blocks", () => {
    const plan = buildZbfPlan([guest, guest2], portal, null, nets, zones, [dns]);
    const allow = plan.policies.find((p) => p.name.includes("critical 10.0.20.5"))!;
    assert.equal(allow.action, "ALLOW");
    assert.equal(allow.protocol, "tcp_udp");
    assert.deepEqual([allow.destination.ip, allow.destination.port, allow.destination.zoneId], ["10.0.20.5", "53", "z1"]);
    const firstBlock = plan.policies.findIndex((p) => p.action === "BLOCK");
    assert.ok(plan.policies.indexOf(allow) < firstBlock);
  });

  it("emits a single all-protocol any-port allow for @all", () => {
    const plan = buildZbfPlan([guest, guest2], portal, null, nets, zones, [dhcp]);
    const allow = plan.policies.find((p) => p.name.includes("critical 10.0.20.6"))!;
    assert.equal(allow.protocol, "all");
    assert.equal(allow.destination.port, null);
  });

  it("dedupes against the auto DNS allows for the same server and port", () => {
    const g1 = { ...guest, dnsServers: ["10.0.20.5"] };
    const plan = buildZbfPlan([g1, guest2], portal, null, [corp, mgmt, g1, guest2], zones, [dns]);
    const covering = plan.policies.filter(
      (p) => p.action === "ALLOW" && p.destination.ip === "10.0.20.5" && p.destination.port === "53",
    );
    assert.equal(covering.length, 1);
  });

  it("notes entries outside every zoned network instead of planning them", () => {
    const orphan = critical("172.16.9.9@all", "172.16.9.9", "all");
    const plan = buildZbfPlan([guest, guest2], portal, null, nets, zones, [orphan]);
    assert.ok(!plan.policies.some((p) => p.name.includes("172.16.9.9")));
    assert.match(plan.notes.join(" "), /172\.16\.9\.9.*by hand/);
  });

  it("emits protocol-suffixed services and a separate ICMP policy for ping", () => {
    const ntp = critical("10.0.20.7@123u+ping", "10.0.20.7", {
      services: [{ port: "123", proto: "udp" }],
      ping: true,
    });
    const plan = buildZbfPlan([guest, guest2], portal, null, nets, zones, [ntp]);
    const allows = plan.policies.filter((p) => p.name.includes("critical 10.0.20.7"));
    assert.deepEqual(
      allows.map((p) => [p.protocol, p.destination.port]),
      [["udp", "123"], ["icmp", null]],
    );
    assert.match(allows[1].name, /\(ping\)/);
  });

  it("marks an @all critical entry safe in the assessment (allow shields it)", () => {
    const plan = buildZbfPlan([guest, guest2], portal, null, nets, zones, [dhcp]);
    const a = assessZbfCritical(plan.policies, [dhcp], nets, zones);
    assert.equal(a.verdicts[0].status, "safe");
    assert.match(a.verdicts[0].detail, /Allowed above the blocks/);
  });
});

describe("assessZbfLockout internet-side admins", () => {
  it("passes (not just shrugs) for a public admin IP", () => {
    const plan = buildZbfPlan([guest, guest2], portal, null, nets, zones);
    const a = assessZbfLockout(plan.policies, "154.62.191.142", nets, zones, ["10.90.0.232"]);
    assert.equal(a.blocked, false);
    assert.match(a.warnings.join(" "), /Lockout check passed: .*internet/);
  });

  it("still cannot vouch for a PRIVATE IP outside every known network", () => {
    const plan = buildZbfPlan([guest, guest2], portal, null, nets, zones);
    const a = assessZbfLockout(plan.policies, "172.31.0.9", nets, zones, ["10.90.0.232"]);
    assert.match(a.warnings.join(" "), /cannot vouch/);
  });
});
