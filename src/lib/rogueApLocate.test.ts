import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupRogueSightings, macOui, macToInt, proximity, rogueCandidates } from "./rogueApLocate.ts";
import type { ClassifiedRogue } from "./rogueAps.ts";

function rogue(p: Partial<ClassifiedRogue>): ClassifiedRogue {
  return {
    bssid: "aa:bb:cc:00:00:01",
    ssid: "Guest",
    spoofing: false,
    rogueClass: "neighbour",
    ...p,
  } as ClassifiedRogue;
}

describe("macToInt / macOui", () => {
  it("parses and extracts the OUI", () => {
    assert.equal(macToInt("00:00:00:00:00:01"), 1);
    assert.equal(macOui("Aa:Bb:Cc:11:22:33"), "aa:bb:cc");
  });
  it("rejects junk", () => {
    assert.equal(macToInt("nope"), null);
    assert.equal(macOui("zz"), "");
  });
});

describe("proximity", () => {
  it("bands by RSSI and gives a closeness for the plot", () => {
    assert.equal(proximity(-45).bucket, "very-close");
    assert.equal(proximity(-60).bucket, "near");
    assert.equal(proximity(-75).bucket, "far");
    assert.equal(proximity(-88).bucket, "distant");
    assert.ok(proximity(-30).closeness > proximity(-85).closeness);
    assert.equal(proximity(-30).closeness, 1);
    assert.equal(proximity(-90).closeness, 0);
  });
});

describe("groupRogueSightings", () => {
  it("collects every AP that heard a BSSID, strongest first, deduped", () => {
    const groups = groupRogueSightings([
      rogue({ bssid: "aa:bb:cc:00:00:01", ap_mac: "de:ad:00:00:00:01", signal: -70 }),
      rogue({ bssid: "aa:bb:cc:00:00:01", ap_mac: "de:ad:00:00:00:02", rssi: -50 }),
      rogue({ bssid: "aa:bb:cc:00:00:01", ap_mac: "de:ad:00:00:00:02", signal: -55 }), // dup AP, weaker → ignored
    ]);
    assert.equal(groups.length, 1);
    assert.deepEqual(
      groups[0].sightings.map((s) => [s.apMac, s.rssi]),
      [
        ["de:ad:00:00:00:02", -50],
        ["de:ad:00:00:00:01", -70],
      ],
    );
  });

  it("orders open spoofs first, then loudest", () => {
    const groups = groupRogueSightings([
      rogue({ bssid: "11:11:11:00:00:01", ssid: "Guest", ap_mac: "ap:1", signal: -80 }),
      rogue({ bssid: "22:22:22:00:00:02", ssid: "Guest", spoofing: true, rogueClass: "spoof_open", ap_mac: "ap:2", signal: -75 }),
      rogue({ bssid: "33:33:33:00:00:03", ssid: "Guest", spoofing: true, rogueClass: "spoof", ap_mac: "ap:3", signal: -60 }),
    ]);
    assert.deepEqual(groups.map((g) => g.bssid), ["22:22:22:00:00:02", "33:33:33:00:00:03", "11:11:11:00:00:01"]);
  });
});

describe("rogueCandidates", () => {
  it("flags MAC-adjacent same-OUI devices as high confidence", () => {
    const c = rogueCandidates("aa:bb:cc:00:10:00", [
      "aa:bb:cc:00:10:01", // adjacent → high
      "aa:bb:cc:99:99:99", // same OUI, far → low
      "11:22:33:00:10:01", // different OUI → excluded
    ]);
    assert.equal(c.length, 2);
    assert.equal(c[0].mac, "aa:bb:cc:00:10:01");
    assert.equal(c[0].confidence, "high");
    assert.equal(c[1].confidence, "low");
  });

  it("excludes the BSSID itself and returns nothing for an unparseable BSSID", () => {
    assert.deepEqual(rogueCandidates("aa:bb:cc:00:10:00", ["aa:bb:cc:00:10:00"]), []);
    assert.deepEqual(rogueCandidates("garbage", ["aa:bb:cc:00:10:01"]), []);
  });
});
