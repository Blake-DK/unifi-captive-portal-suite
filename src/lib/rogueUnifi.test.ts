import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRogueRows,
  hiddenMacs,
  isUbiquitiMac,
  isUbiquitiVendor,
  reconnectedIgnores,
} from "./rogueUnifi.ts"; // explicit extension for Node's type-stripping runner

const ap = { mac: "24:5a:4c:11:22:33", oui: "Ubiquiti", ip: "10.90.0.77", is_wired: true };
const laptop = { mac: "aa:bb:cc:dd:ee:ff", oui: "Dell", ip: "10.90.0.20" };
// The live case: a locally-administered MAC whose physical form is Ubiquiti.
const virtualUnifi = { mac: "3e:78:95:01:76:94", oui: null, ip: "10.90.0.90" };

describe("vendor detection", () => {
  it("matches the controller's own vendor string", () => {
    assert.equal(isUbiquitiVendor("Ubiquiti Inc."), true);
    assert.equal(isUbiquitiVendor("UniFi"), true);
    assert.equal(isUbiquitiVendor("Apple, Inc."), false);
    assert.equal(isUbiquitiVendor(null), false);
  });

  it("matches only GLOBALLY-administered Ubiquiti OUIs", () => {
    assert.equal(isUbiquitiMac("24:5a:4c:11:22:33"), true);
    assert.equal(isUbiquitiMac("f4:e2:c6:b4:54:42"), true); // EdgeSwitch
    assert.equal(isUbiquitiMac("aa:bb:cc:dd:ee:ff"), false);
  });

  it("never OUI-matches a randomised MAC — its vendor prefix is fabricated", () => {
    // e0:63:da is Ubiquiti; e2:63:da is that prefix with the LA bit set, i.e.
    // a private client MAC that merely collides. This is the same mistake the
    // controller makes when it refuses to block a randomised TP-Link extender.
    assert.equal(isUbiquitiMac("e2:63:da:00:00:01"), false);
    // The live false positive: a TP-Link RE315 on a private MAC.
    assert.equal(isUbiquitiMac("3e:78:95:01:76:94"), false);
  });
});

describe("buildRogueRows", () => {
  it("lists UniFi-vendor stations and ignores ordinary clients", () => {
    const rows = buildRogueRows([ap, laptop], []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].mac, ap.mac);
    assert.equal(rows[0].status, "detected");
    assert.match(rows[0].reason, /not adopted/);
  });

  it("includes an operator-marked station even with no vendor signal", () => {
    const rows = buildRogueRows([laptop], [{ mac: laptop.mac, status: "marked", note: "old AP" }]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "marked");
    assert.equal(rows[0].note, "old AP");
  });

  it("keeps a permanent ignore hidden-but-listed with its note", () => {
    const rows = buildRogueRows([ap], [{ mac: ap.mac, status: "ignored", note: "neighbour" }]);
    assert.equal(rows[0].status, "ignored");
    assert.equal(rows[0].note, "neighbour");
  });

  it("auto-clears ignore-until-reconnect once the device is online again", () => {
    const decisions = [{ mac: ap.mac, status: "ignored-until-reconnect", note: "" }];
    assert.deepEqual(reconnectedIgnores([ap], decisions), [ap.mac]);
    // The row shows as a live rogue again, not as ignored.
    assert.equal(buildRogueRows([ap], decisions)[0].status, "detected");
    // While offline, nothing revives.
    assert.deepEqual(reconnectedIgnores([], decisions), []);
  });

  it("lists offline decisions so an ignore can be reviewed when unplugged", () => {
    const rows = buildRogueRows([], [{ mac: ap.mac, status: "ignored", note: "n" }]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].online, false);
    assert.match(rows[0].reason, /Not currently connected/);
  });

  it("sorts online rows before offline ones", () => {
    const rows = buildRogueRows([ap], [{ mac: "e0:63:da:99:99:99", status: "marked", note: "" }]);
    assert.equal(rows[0].online, true);
    assert.equal(rows[1].online, false);
  });

  it("leaves randomised client MACs alone even when the prefix collides", () => {
    // The RE315 (TP-Link extender, private MAC, blank oui) must NOT land here:
    // it belongs on the Extenders tab. Verified against live controller data.
    assert.deepEqual(buildRogueRows([virtualUnifi], []), []);
    assert.deepEqual(buildRogueRows([{ mac: "e2:63:da:01:02:03", oui: null }], []), []);
  });

  it("flags the real un-onboarded Ubiquiti gear seen live (EdgeSwitch)", () => {
    const edge = { mac: "f4:e2:c6:b4:54:42", oui: "Ubiquiti Inc", ip: "192.168.1.111" };
    const rows = buildRogueRows([edge], []);
    assert.equal(rows.length, 1);
    assert.match(rows[0].reason, /not adopted/);
  });
});

describe("hiddenMacs", () => {
  it("hides both ignore flavours from the client tables, never the marked ones", () => {
    const hidden = hiddenMacs([
      { mac: "a", status: "ignored", note: "" },
      { mac: "b", status: "ignored-until-reconnect", note: "" },
      { mac: "c", status: "marked", note: "" },
    ]);
    assert.deepEqual([...hidden].sort(), ["a", "b"]);
  });
});
