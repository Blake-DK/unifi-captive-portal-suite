import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateCanary, evaluateSnmpSweep, hasPollableIp, pickSample, summarize, type SnmpTargetLite } from "./snmpFallback.ts"; // explicit extension for Node's type-stripping runner

const targets: SnmpTargetLite[] = [
  { mac: "aa:00:00:00:00:01", ip: "10.0.0.1", name: "GW", type: "udm" },
  { mac: "aa:00:00:00:00:02", ip: "10.0.0.2", name: "AP-1", type: "uap" },
  { mac: "aa:00:00:00:00:03", ip: "10.0.0.3", name: "SW-1", type: "usw" },
  { mac: "aa:00:00:00:00:04", ip: "10.0.0.4", name: "AP-2", type: "uap" },
];

describe("hasPollableIp", () => {
  it("accepts RFC1918 and link-local addresses", () => {
    assert.ok(hasPollableIp("10.0.0.1"));
    assert.ok(hasPollableIp("172.16.0.1"));
    assert.ok(hasPollableIp("172.31.255.255"));
    assert.ok(hasPollableIp("192.168.1.181"));
    assert.ok(hasPollableIp("169.254.1.1"));
    assert.ok(hasPollableIp("127.0.0.1"));
  });

  it("rejects a public IP — confirmed live 2026-07-15: a gateway's reported ip was its WAN address and timed out", () => {
    assert.ok(!hasPollableIp("31.121.224.239"));
    assert.ok(!hasPollableIp("8.8.8.8"));
    assert.ok(!hasPollableIp("172.15.0.1")); // just outside the 172.16-31 range
    assert.ok(!hasPollableIp("172.32.0.1"));
  });

  it("rejects missing or malformed input", () => {
    assert.ok(!hasPollableIp(undefined));
    assert.ok(!hasPollableIp(""));
    assert.ok(!hasPollableIp("not-an-ip"));
  });
});

describe("pickSample", () => {
  it("picks one gateway, one AP, one switch when types are known", () => {
    const sample = pickSample(targets);
    assert.deepEqual(
      sample.map((t) => t.mac),
      ["aa:00:00:00:00:01", "aa:00:00:00:00:02", "aa:00:00:00:00:03"],
    );
  });

  it("falls back to the first N when types are unknown", () => {
    const untyped: SnmpTargetLite[] = [
      { mac: "a", ip: "1", name: "A" },
      { mac: "b", ip: "2", name: "B" },
      { mac: "c", ip: "3", name: "C" },
    ];
    assert.equal(pickSample(untyped).length, 3);
  });

  it("respects a smaller limit", () => {
    assert.equal(pickSample(targets, 1).length, 1);
  });
});

describe("evaluateSnmpSweep", () => {
  it("opens an alert only for unreachable targets", () => {
    const out = evaluateSnmpSweep(targets.slice(0, 2), [
      { mac: "aa:00:00:00:00:01", ip: "10.0.0.1", reachable: true },
      { mac: "aa:00:00:00:00:02", ip: "10.0.0.2", reachable: false, error: "Request timed out" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "snmp_offline");
    assert.equal(out[0].target, "aa:00:00:00:00:02");
    assert.match(out[0].message, /AP-1 unreachable via SNMP/);
  });

  it("returns nothing when every target answers", () => {
    const out = evaluateSnmpSweep(targets, targets.map((t) => ({ mac: t.mac, ip: t.ip, reachable: true })));
    assert.deepEqual(out, []);
  });
});

describe("summarize", () => {
  it("counts reachable vs total", () => {
    const out = summarize(targets.slice(0, 2), [
      { mac: "aa:00:00:00:00:01", ip: "10.0.0.1", reachable: true },
      { mac: "aa:00:00:00:00:02", ip: "10.0.0.2", reachable: false },
    ]);
    assert.equal(out, "1/2 devices answering via SNMP");
  });
});

describe("evaluateCanary", () => {
  it("fires only when every sampled target is unreachable", () => {
    const sample = targets.slice(0, 3);
    const allDown = evaluateCanary(sample, sample.map((t) => ({ mac: t.mac, ip: t.ip, reachable: false, error: "timeout" })));
    assert.ok(allDown);
    assert.equal(allDown.target, "snmp:canary");
    assert.equal(allDown.severity, "warning");
    assert.match(allDown.message, /timeout/);
  });

  it("stays quiet when at least one target answers", () => {
    const sample = targets.slice(0, 3);
    const mixed = evaluateCanary(sample, [
      { mac: sample[0].mac, ip: sample[0].ip, reachable: true },
      { mac: sample[1].mac, ip: sample[1].ip, reachable: false },
      { mac: sample[2].mac, ip: sample[2].ip, reachable: false },
    ]);
    assert.equal(mixed, null);
  });

  it("stays quiet on an empty sample", () => {
    assert.equal(evaluateCanary([], []), null);
  });
});
