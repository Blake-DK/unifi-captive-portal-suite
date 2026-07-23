import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderSyslogLine } from "./auditSyslog.ts"; // explicit extension for Node's type-stripping runner

describe("renderSyslogLine", () => {
  it("emits RFC 5424 with local0.info and a JSON payload", () => {
    const line = renderSyslogLine(
      {
        createdAt: new Date("2026-07-11T12:00:00.000Z"),
        actorType: "guest",
        actor: "5551234567",
        action: "guest.register",
        target: "aa:bb:cc:11:22:33",
        outcome: "success",
        ip: "10.0.40.7",
        detail: { locationName: "On Base" },
      },
      "portal-host",
    );
    assert.ok(line.startsWith("<134>1 2026-07-11T12:00:00.000Z portal-host portal-audit - - - "));
    const payload = JSON.parse(line.slice(line.indexOf("- - - ") + 6));
    assert.equal(payload.action, "guest.register");
    assert.equal(payload.target, "aa:bb:cc:11:22:33");
    assert.equal(payload.detail.locationName, "On Base");
  });

  it("defaults outcome and nulls the optionals", () => {
    const line = renderSyslogLine({
      createdAt: new Date(0),
      actorType: "admin",
      actor: "x",
      action: "a.b",
    });
    const payload = JSON.parse(line.slice(line.indexOf("- - - ") + 6));
    assert.equal(payload.outcome, "success");
    assert.equal(payload.target, null);
    assert.equal(payload.ip, null);
  });
});
