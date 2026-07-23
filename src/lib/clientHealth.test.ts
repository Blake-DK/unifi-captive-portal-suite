import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { journeyFromEvents, scoreClient } from "./clientHealth.ts"; // explicit extension for Node's type-stripping runner

describe("scoreClient", () => {
  it("offline is 0, wired is 10", () => {
    assert.equal(scoreClient({ connected: false, wired: false }).score, 0);
    assert.equal(scoreClient({ connected: false, wired: false }).label, "offline");
    assert.equal(scoreClient({ connected: true, wired: true }).score, 10);
  });

  it("wireless thresholds: both good 10, one 7, neither 4", () => {
    assert.equal(scoreClient({ connected: true, wired: false, signalDbm: -60, snrDb: 30 }).score, 10);
    assert.equal(scoreClient({ connected: true, wired: false, signalDbm: -80, snrDb: 30 }).score, 7);
    assert.equal(scoreClient({ connected: true, wired: false, signalDbm: -80, snrDb: 5 }).score, 4);
  });

  it("judges on whatever readings exist", () => {
    assert.equal(scoreClient({ connected: true, wired: false, snrDb: 30 }).score, 10);
    assert.equal(scoreClient({ connected: true, wired: false, snrDb: 3 }).score, 4);
    assert.equal(scoreClient({ connected: true, wired: false }).score, 7);
    assert.equal(scoreClient({ connected: true, wired: false }).label, "fair");
  });

  it("reasons name the thresholds", () => {
    const r = scoreClient({ connected: true, wired: false, signalDbm: -80, snrDb: 30 }).reasons;
    assert.match(r.join(" "), /-80 dBm \(below -72\)/);
    assert.match(r.join(" "), /30 dB \(above 9\)/);
  });
});

describe("journeyFromEvents", () => {
  const mac = "aa:bb:cc:11:22:33";
  const events = [
    { key: "EVT_WU_Connected", time: 3, user: mac, msg: "User connected to Base", ap_name: "AP-1" },
    { key: "EVT_WU_Roam", time: 5, user: mac, msg: "roamed from AP-1 to AP-2" },
    { key: "EVT_WG_Disconnected", time: 7, guest: mac.toUpperCase(), msg: "Guest disconnected" },
    { key: "EVT_WU_Connected", time: 4, user: "ff:ff:ff:00:00:00", msg: "someone else" },
    { key: "EVT_AP_Lost_Contact", time: 6, ap: "dd:dd", msg: "not a client event" },
  ];

  it("filters to the client (user or guest, case-insensitive), newest first", () => {
    const j = journeyFromEvents(events, mac);
    assert.deepEqual(
      j.map((e) => [e.time, e.kind]),
      [
        [7, "disconnect"],
        [5, "roam"],
        [3, "connect"],
      ],
    );
    assert.equal(j[2].ap, "AP-1");
  });

  it("drops entries without a timestamp", () => {
    assert.equal(journeyFromEvents([{ key: "EVT_WU_Connected", user: mac }], mac).length, 0);
  });
});
