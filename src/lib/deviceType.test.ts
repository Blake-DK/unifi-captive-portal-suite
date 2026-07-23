import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyDevice, parseBuildingToken, parseDeviceType } from "./deviceType.ts"; // explicit extension for Node's type-stripping runner

describe("parseDeviceType", () => {
  it("reads the naming-convention token", () => {
    assert.equal(parseDeviceType("12-F3-AP-4821"), "AP");
    assert.equal(parseDeviceType("7-DN-0091"), "DN");
    assert.equal(parseDeviceType("1221-CN"), "CN");
    assert.equal(parseDeviceType("491-Housing-UBB-A"), "UBB");
    assert.equal(parseDeviceType("1221-can"), "CAN");
  });

  it("ignores punctuation stuck to a token", () => {
    // Real device from the site: placeholder id typed into the name.
    assert.equal(parseDeviceType("552-F3-RM345-AP???"), "AP");
    assert.equal(parseDeviceType("12-(AP)-1"), "AP");
  });

  it("does not match token-with-id or lookalike words", () => {
    assert.equal(parseDeviceType("AP4821"), null);
    assert.equal(parseDeviceType("Lobby-Apex"), null);
    assert.equal(parseDeviceType(""), null);
    assert.equal(parseDeviceType(undefined), null);
  });
});

describe("parseBuildingToken", () => {
  it("reads the leading building token", () => {
    assert.equal(parseBuildingToken("12-F3-AP-4821"), "12");
    assert.equal(parseBuildingToken("1221-CN"), "1221");
    assert.equal(parseBuildingToken("491-Housing-UBB-A"), "491");
    assert.equal(parseBuildingToken("552-F3-RM345-AP???"), "552");
  });

  it("returns null when there is no building part", () => {
    assert.equal(parseBuildingToken("AP-lobby"), null, "starts with a type token");
    assert.equal(parseBuildingToken(""), null);
    assert.equal(parseBuildingToken(undefined), null);
  });
});

describe("classifyDevice", () => {
  it("falls back to hardware type/model for UBB only", () => {
    assert.equal(classifyDevice("Bridge roof", "ubb", "UBB-XG"), "UBB");
    assert.equal(classifyDevice("Basement switch", "usw", "USW-Pro-48"), null);
  });

  it("prefers the name token over hardware", () => {
    assert.equal(classifyDevice("12-F3-AP-4821", "uap", "U6-Pro"), "AP");
  });
});
