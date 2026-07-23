import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyDuplicateIp,
  isDuplicateIpAlarm,
  isLocallyAdministered,
  parseArpingMap,
  parseArpingResponders,
  parseDuplicateIpAlarm,
  windowsOverlap,
  type DupIpAlarm,
} from "./dupIp.ts"; // explicit extension: Node's type-stripping test runner resolves it as-is

// Runs with Node's built-in runner (`npm test`) — no framework, no controller.

const CHECKS_ALL = { macRandom: true, sessions: true, dhcp: true };
const NO_DATA = { windows: new Map(), stations: [] };

describe("isLocallyAdministered", () => {
  it("flags randomised MACs (bit 1 of the first octet)", () => {
    assert.equal(isLocallyAdministered("da:81:9b:00:11:22"), true); // 0xda & 0x02
    assert.equal(isLocallyAdministered("02:00:00:aa:bb:cc"), true);
    assert.equal(isLocallyAdministered("f4:e2:c6:00:11:22"), false); // Ubiquiti OUI
    assert.equal(isLocallyAdministered("00:11:22:33:44:55"), false);
  });
});

describe("parseDuplicateIpAlarm", () => {
  it("parses IP, MACs and VLAN from message text", () => {
    const alarm = parseDuplicateIpAlarm({
      key: "EVT_LU_DuplicateIp",
      time: 1751900000000,
      msg: 'Duplicate IP 10.91.0.7 detected on VLAN "420" between da:81:9b:00:11:22 and 6e:44:aa:bb:cc:dd',
    });
    assert.ok(alarm);
    assert.equal(alarm.ip, "10.91.0.7");
    assert.deepEqual(alarm.macs, ["6e:44:aa:bb:cc:dd", "da:81:9b:00:11:22"]);
    assert.equal(alarm.vlan, 420);
    assert.equal(alarm.timeMs, 1751900000000);
  });

  it("prefers structured fields over the message", () => {
    const alarm = parseDuplicateIpAlarm({
      key: "duplicate_ip_conflict",
      ip: "10.0.0.5",
      vlan: 10,
      mac: "AA-BB-CC-DD-EE-FF",
      msg: "IP conflict detected",
    });
    assert.ok(alarm);
    assert.equal(alarm.ip, "10.0.0.5");
    assert.equal(alarm.vlan, 10);
    assert.deepEqual(alarm.macs, ["aa:bb:cc:dd:ee:ff"]);
  });

  it("returns null for non-duplicate-IP alarms and for alarms without an IP", () => {
    assert.equal(parseDuplicateIpAlarm({ key: "EVT_AP_Lost_Contact", msg: "AP disconnected" }), null);
    assert.equal(parseDuplicateIpAlarm({ key: "EVT_LU_DuplicateIp", msg: "no address here" }), null);
  });

  it("recognises key/msg wording variants", () => {
    assert.equal(isDuplicateIpAlarm({ key: "EVT_IpConflict" }), true);
    assert.equal(isDuplicateIpAlarm({ msg: "IP address conflict on LAN" }), true);
    assert.equal(isDuplicateIpAlarm({ key: "EVT_SW_PortLinkUp" }), false);
  });
});

describe("windowsOverlap", () => {
  it("detects overlap and separation, treating unknown bounds as open", () => {
    assert.equal(windowsOverlap({ startSec: 0, endSec: 10 }, { startSec: 5, endSec: 15 }), true);
    assert.equal(windowsOverlap({ startSec: 0, endSec: 10 }, { startSec: 11, endSec: 15 }), false);
    assert.equal(windowsOverlap({}, { startSec: 5, endSec: 15 }), true);
  });
});

describe("classifyDuplicateIp", () => {
  const alarm: DupIpAlarm = {
    ip: "10.91.0.7",
    macs: ["6e:44:aa:bb:cc:dd", "da:81:9b:00:11:22"], // both randomised
    vlan: 420,
  };

  it("(a) suppresses when both MACs are randomised", () => {
    const v = classifyDuplicateIp(alarm, CHECKS_ALL, NO_DATA);
    assert.equal(v.verdict, "suppress");
    assert.match(v.reasons[0], /randomised/);
  });

  const realMacs: DupIpAlarm = { ip: "10.91.0.7", macs: ["00:11:22:33:44:55", "f4:e2:c6:00:11:22"] };

  it("(b) suppresses when the sessions never overlap", () => {
    const v = classifyDuplicateIp(realMacs, CHECKS_ALL, {
      windows: new Map([
        ["00:11:22:33:44:55", { startSec: 0, endSec: 100 }],
        ["f4:e2:c6:00:11:22", { startSec: 200, endSec: 300 }],
      ]),
      stations: [],
    });
    assert.equal(v.verdict, "suppress");
    assert.match(v.reasons[0], /do not overlap/);
  });

  it("(b) suppresses when only one of the two clients is online", () => {
    const v = classifyDuplicateIp(realMacs, CHECKS_ALL, {
      windows: new Map([["00:11:22:33:44:55", { startSec: 0 }]]),
      stations: [{ mac: "00:11:22:33:44:55", ip: "10.91.0.7" }],
    });
    assert.equal(v.verdict, "suppress");
    assert.match(v.reasons[0], /at most one/);
  });

  const overlapping = new Map([
    ["00:11:22:33:44:55", { startSec: 0 }],
    ["f4:e2:c6:00:11:22", { startSec: 0 }],
  ]);

  it("(c) flags genuine when two connected clients hold the IP", () => {
    const v = classifyDuplicateIp(realMacs, CHECKS_ALL, {
      windows: overlapping,
      stations: [
        { mac: "00:11:22:33:44:55", ip: "10.91.0.7" },
        { mac: "f4:e2:c6:00:11:22", ip: "10.91.0.7" },
      ],
    });
    assert.equal(v.verdict, "genuine");
  });

  it("(c) suppresses when exactly one connected client holds the IP", () => {
    const v = classifyDuplicateIp(realMacs, CHECKS_ALL, {
      windows: overlapping,
      stations: [
        { mac: "00:11:22:33:44:55", ip: "10.91.0.7" },
        { mac: "f4:e2:c6:00:11:22", ip: "10.91.0.8" },
      ],
    });
    assert.equal(v.verdict, "suppress");
  });

  it("is inconclusive when checks are disabled or data is missing", () => {
    const v = classifyDuplicateIp(realMacs, { macRandom: false, sessions: false, dhcp: false }, NO_DATA);
    assert.equal(v.verdict, "inconclusive");
    // With checks on but no station snapshot, (c) must not decide either.
    const v2 = classifyDuplicateIp(realMacs, CHECKS_ALL, { windows: overlapping, stations: [] });
    assert.equal(v2.verdict, "inconclusive");
  });
});

describe("parseArpingMap", () => {
  it("parses vlan=mac lines with a wildcard", () => {
    const map = parseArpingMap("420=AA:BB:CC:DD:EE:FF\n# comment\n*=11-22-33-44-55-66\nbogus line");
    assert.equal(map.get("420"), "aa:bb:cc:dd:ee:ff");
    assert.equal(map.get("*"), "11:22:33:44:55:66");
    assert.equal(map.size, 2);
  });
});

describe("parseArpingResponders", () => {
  it("counts distinct responders across arping and ip-neigh output", () => {
    const out = [
      "ARPING 10.91.0.7 from 10.91.0.1 br420",
      "Unicast reply from 10.91.0.7 [00:11:22:33:44:55] 1.2ms",
      "Unicast reply from 10.91.0.7 [F4:E2:C6:00:11:22] 3.4ms",
      "10.91.0.7 dev br420 lladdr 00:11:22:33:44:55 REACHABLE",
    ].join("\n");
    assert.deepEqual(parseArpingResponders(out), ["00:11:22:33:44:55", "f4:e2:c6:00:11:22"]);
  });

  it("excludes the probing device and the zero MAC", () => {
    const out = "reply [00:11:22:33:44:55]; probe from [AA:BB:CC:DD:EE:FF]; bad [00:00:00:00:00:00]";
    assert.deepEqual(parseArpingResponders(out, "aa:bb:cc:dd:ee:ff"), ["00:11:22:33:44:55"]);
  });
});
