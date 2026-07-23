import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeFunnel } from "./connectionFunnel.ts"; // explicit extension for Node's type-stripping runner

describe("analyzeFunnel", () => {
  it("buckets events into stages and counts failures", () => {
    const r = analyzeFunnel([
      { key: "EVT_WU_Connected", msg: "connected", user: "aa" },
      { key: "EVT_WU_Connected", msg: "connected", user: "bb" },
      { key: "EVT_WU_AuthFailure", msg: "authentication failed", user: "aa", time: 5 },
      { key: "EVT_WU_Disconnected", msg: "left", user: "bb" }, // normal leave, not a failure
      { key: "EVT_WU_Roam", msg: "roamed", user: "aa" },
      { key: "EVT_LU_Connected", msg: "client got no IP from DHCP", user: "cc", time: 9 },
    ]);
    const byStage = Object.fromEntries(r.stages.map((s) => [s.stage, s]));
    assert.equal(byStage.association.total, 3); // 2 connect + 1 disconnect
    assert.equal(byStage.association.failed, 0);
    assert.equal(byStage.authentication.failed, 1);
    assert.equal(byStage.dhcp.failed, 1);
    assert.equal(byStage.roaming.total, 1);
  });

  it("ranks the clients failing most, with their last reason", () => {
    const r = analyzeFunnel([
      { key: "EVT_WU_AuthFailure", msg: "psk mismatch", user: "aa", time: 1 },
      { key: "EVT_WU_AuthFailure", msg: "psk mismatch again", user: "aa", time: 9 },
      { key: "EVT_WG_AuthFailure", msg: "bad", guest: "bb", time: 3 },
    ]);
    assert.equal(r.topFailers[0].mac, "aa");
    assert.equal(r.topFailers[0].failures, 2);
    assert.equal(r.topFailers[0].lastReason, "psk mismatch again"); // newest wins
  });

  it("ignores events that aren't onboarding-related", () => {
    const r = analyzeFunnel([
      { key: "EVT_SW_PortLinkUp", msg: "port up" },
      { key: "EVT_AP_Lost_Contact", msg: "lost contact" },
    ]);
    assert.equal(r.windowEvents, 0);
  });
});
