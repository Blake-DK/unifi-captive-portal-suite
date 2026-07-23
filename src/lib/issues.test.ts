import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adjustHealthForIgnored, deviceIssues, groupIssuesByDevice } from "./issues.ts"; // explicit extension for Node's type-stripping runner

import type { UniFiDeviceHealth, UniFiSubsystemHealth } from "./unifi.ts";

const dev = (mac: string, type: string, state: number, name = mac): UniFiDeviceHealth =>
  ({ mac, type, state, name }) as UniFiDeviceHealth;

const lan = (num_sw: number, num_disconnected: number): UniFiSubsystemHealth => ({
  subsystem: "lan",
  status: "ok",
  num_sw,
  num_disconnected,
});

describe("adjustHealthForIgnored", () => {
  it("subtracts an ignored offline switch from the LAN totals", () => {
    const [h] = adjustHealthForIgnored([lan(10, 1)], [dev("aa:bb:cc:dd:ee:ff", "usw", 0)]);
    assert.equal(h.num_sw, 9);
    assert.equal(h.num_disconnected, 0);
  });

  it("leaves health untouched when nothing is ignored", () => {
    const health = [lan(10, 1)];
    assert.equal(adjustHealthForIgnored(health, []), health);
  });

  it("counts an ignored AP against wlan, not lan", () => {
    const health: UniFiSubsystemHealth[] = [
      lan(10, 1),
      { subsystem: "wlan", num_ap: 5, num_disconnected: 2 },
    ];
    const [l, w] = adjustHealthForIgnored(health, [dev("a", "uap", 0)]);
    assert.equal(l.num_sw, 10, "lan untouched");
    assert.equal(l.num_disconnected, 1);
    assert.equal(w.num_ap, 4);
    assert.equal(w.num_disconnected, 1);
  });

  it("only the offline ones come off num_disconnected", () => {
    // An online device can't be ignored (the API refuses), but the sweep is
    // async — a stale row must never push the count below the truth.
    const [h] = adjustHealthForIgnored([lan(10, 1)], [dev("a", "usw", 1)]);
    assert.equal(h.num_sw, 9);
    assert.equal(h.num_disconnected, 1);
  });

  it("a transitional state is not subtracted from num_disconnected", () => {
    // state 5 = provisioning. If it were subtracted while the controller only
    // counts state 0, the count would drop a disconnect owed to another device.
    const [h] = adjustHealthForIgnored([lan(10, 1)], [dev("a", "usw", 5)]);
    assert.equal(h.num_sw, 9);
    assert.equal(h.num_disconnected, 1);
  });

  it("clears a degraded status when every disconnect is ignored", () => {
    const [h] = adjustHealthForIgnored(
      [{ ...lan(10, 1), status: "error" }],
      [dev("a", "usw", 0)],
    );
    assert.equal(h.num_disconnected, 0);
    assert.equal(h.status, "ok");
  });

  it("keeps a degraded status while other devices are still disconnected", () => {
    const [h] = adjustHealthForIgnored(
      [{ ...lan(10, 2), status: "error" }],
      [dev("a", "usw", 0)],
    );
    assert.equal(h.num_disconnected, 1);
    assert.equal(h.status, "error");
  });

  it("keeps a degraded status that no disconnect explains", () => {
    // num_disconnected is already 0, so the controller degraded the subsystem
    // for some other reason; the ignore must not paper over it.
    const [h] = adjustHealthForIgnored(
      [{ ...lan(10, 0), status: "warning" }],
      [dev("a", "usw", 0)],
    );
    assert.equal(h.status, "warning");
  });

  it("never goes negative, and leaves gateways to the controller", () => {
    const [h] = adjustHealthForIgnored([lan(0, 0)], [dev("a", "usw", 0)]);
    assert.equal(h.num_sw, 0);
    assert.equal(h.num_disconnected, 0);
    const health = [{ subsystem: "wan", num_gw: 1, num_disconnected: 1 }];
    assert.deepEqual(adjustHealthForIgnored(health, [dev("a", "uxg", 0)]), health);
  });

  it("kills the disconnected issue an ignored switch was raising", () => {
    const ignored = [dev("aa:bb:cc:dd:ee:ff", "usw", 0, "Old switch")];
    const before = deviceIssues([lan(10, 1)], []);
    assert.equal(before.filter((i) => /disconnected/.test(i.text)).length, 1);

    const after = deviceIssues(adjustHealthForIgnored([lan(10, 1)], ignored), []);
    assert.equal(after.filter((i) => /disconnected/.test(i.text)).length, 0);
  });

  it("counts an ignored building bridge against wlan", () => {
    const health: UniFiSubsystemHealth[] = [{ subsystem: "wlan", num_ap: 5, num_disconnected: 1 }];
    const [w] = adjustHealthForIgnored(health, [dev("a", "ubb", 0)]);
    assert.equal(w.num_ap, 4);
    assert.equal(w.num_disconnected, 0);
  });

  it("never drops the count below the visibly offline devices", () => {
    // If the ubb→wlan mapping is ever wrong (the controller counted only the
    // offline AP), the subtraction must not hide that AP's disconnect.
    const health: UniFiSubsystemHealth[] = [
      { subsystem: "wlan", num_ap: 5, num_disconnected: 1, status: "error" },
    ];
    const [w] = adjustHealthForIgnored(health, [dev("bridge", "ubb", 0)], [dev("ap", "uap", 0)]);
    assert.equal(w.num_disconnected, 1);
    assert.equal(w.status, "error", "status survives while a visible device is down");
  });
});

describe("groupIssuesByDevice", () => {
  it("anchors issues by MAC and skips subsystem-level ones", () => {
    const issues = deviceIssues([lan(10, 1)], [dev("aa:bb", "usw", 0, "Old switch")]);
    const grouped = groupIssuesByDevice(issues);
    assert.deepEqual(Object.keys(grouped), ["aa:bb"]);
    assert.equal(grouped["aa:bb"][0].severity, "error");
  });
});
