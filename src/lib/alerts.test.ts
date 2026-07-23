import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateAlerts, evaluateControllerDown, type AlertConfig } from "./alerts.ts"; // explicit extension for Node's type-stripping runner

import type { UniFiDeviceHealth } from "./unifi.ts";

describe("evaluateControllerDown", () => {
  const base = { enabled: true, threshold: 3, alreadyOpen: false };

  it("stays quiet below the threshold", () => {
    assert.equal(evaluateControllerDown(1, base), null);
    assert.equal(evaluateControllerDown(2, base), null);
  });

  it("fires at the threshold with severity error", () => {
    const a = evaluateControllerDown(3, base);
    assert.ok(a);
    assert.equal(a.type, "controller_down");
    assert.equal(a.target, "controller");
    assert.equal(a.severity, "error");
    assert.match(a.message, /3 consecutive poll cycles/);
    assert.equal(a.value, "3");
  });

  it("keeps firing above the threshold and carries the error text", () => {
    const a = evaluateControllerDown(7, { ...base, errText: "connect ECONNREFUSED" });
    assert.ok(a);
    assert.match(a.message, /connect ECONNREFUSED/);
  });

  it("an already-open alert keeps refreshing even at streak 1 (process restarted mid-outage)", () => {
    const a = evaluateControllerDown(1, { ...base, alreadyOpen: true });
    assert.ok(a);
    assert.match(a.message, /1 consecutive poll cycle;/);
  });

  it("disabled rule never fires, even with an open alert", () => {
    assert.equal(evaluateControllerDown(10, { ...base, enabled: false }), null);
    assert.equal(evaluateControllerDown(10, { ...base, enabled: false, alreadyOpen: true }), null);
  });

  it("streak 0 never fires (a healthy cycle must not refresh via this path)", () => {
    assert.equal(evaluateControllerDown(0, { ...base, alreadyOpen: true }), null);
  });
});

// Seed coverage for the snapshot rules (the file existed without tests until
// the controller_down work).
const cfg = (over: Partial<AlertConfig> = {}): AlertConfig => ({
  offline: true,
  cpuPct: 0,
  memPct: 0,
  firmware: false,
  subsystem: false,
  saturationPct: 0,
  portErrPct: 0,
  rogueExtender: false,
  ...over,
});

describe("evaluateAlerts", () => {
  it("returns nothing for a healthy snapshot", () => {
    const devices: UniFiDeviceHealth[] = [{ mac: "aa:bb:cc:dd:ee:01", name: "AP-1", state: 1 }];
    assert.deepEqual(evaluateAlerts(devices, [], [], cfg()), []);
  });

  it("opens an offline alert with the state label", () => {
    const devices: UniFiDeviceHealth[] = [{ mac: "aa:bb:cc:dd:ee:02", name: "SW-1", state: 0 }];
    const out = evaluateAlerts(devices, [], [], cfg());
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "offline");
    assert.equal(out[0].target, "aa:bb:cc:dd:ee:02");
    assert.match(out[0].message, /SW-1 is offline/);
  });

  it("cpu/mem thresholds only apply to online devices", () => {
    const devices: UniFiDeviceHealth[] = [
      { mac: "aa:bb:cc:dd:ee:03", name: "GW", state: 1, "system-stats": { cpu: "95", mem: "40" } },
      { mac: "aa:bb:cc:dd:ee:04", name: "SW-2", state: 0, "system-stats": { cpu: "99", mem: "99" } },
    ];
    const out = evaluateAlerts(devices, [], [], cfg({ offline: false, cpuPct: 90, memPct: 90 }));
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "cpu");
    assert.equal(out[0].targetName, "GW");
  });

  it("subsystem rule reports disconnected devices as error severity", () => {
    const out = evaluateAlerts([], [{ subsystem: "wlan", status: "ok", num_disconnected: 2 }], [], cfg({ subsystem: true }));
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "subsystem");
    assert.equal(out[0].severity, "error");
    assert.match(out[0].message, /2 device\(s\) disconnected/);
  });
});
