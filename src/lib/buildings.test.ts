import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitBuildings, unknownBuildings } from "./buildings.ts"; // explicit extension for Node's type-stripping runner

describe("splitBuildings", () => {
  it("splits lines, trims, and drops blanks", () => {
    assert.deepEqual(splitBuildings("Block 12\n  Hangar 3 \n\nBuilding 42\n"), [
      "Block 12",
      "Hangar 3",
      "Building 42",
    ]);
  });
});

describe("unknownBuildings", () => {
  const configured = "Block 12\nHangar 3";
  it("returns typed values missing from the configured list, most-typed first", () => {
    assert.deepEqual(
      unknownBuildings(configured, [
        { value: "Building 552", count: 2 },
        { value: "Tower 9", count: 7 },
      ]),
      ["Tower 9", "Building 552"],
    );
  });
  it("matches the configured list case-insensitively", () => {
    assert.deepEqual(unknownBuildings(configured, [{ value: "block 12", count: 3 }]), []);
    assert.deepEqual(unknownBuildings(configured, [{ value: "HANGAR 3", count: 1 }]), []);
  });
  it("collapses spellings of the same unknown building and sums their counts", () => {
    assert.deepEqual(
      unknownBuildings(configured, [
        { value: "tower 9", count: 1 },
        { value: "Tower 9", count: 1 },
        { value: "Shed 1", count: 3 },
      ]),
      ["Shed 1", "tower 9"],
    );
  });
  it("ignores blanks and null values, breaks count ties alphabetically", () => {
    assert.deepEqual(
      unknownBuildings("", [
        { value: null, count: 5 },
        { value: "  ", count: 5 },
        { value: "B", count: 1 },
        { value: "A", count: 1 },
      ]),
      ["A", "B"],
    );
  });
});
