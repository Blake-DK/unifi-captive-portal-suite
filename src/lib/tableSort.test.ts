import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareCells, compareCellsDirected, isEmptyCell, numericCell } from "./tableSort.ts"; // explicit extension for Node's type-stripping runner

describe("numericCell", () => {
  it("parses plain numbers, units, percent and negative dBm", () => {
    assert.equal(numericCell("42"), 42);
    assert.equal(numericCell("1.5 KB"), 1.5 * 1024);
    assert.equal(numericCell("2 GB"), 2 * 1024 ** 3);
    assert.equal(numericCell("-63 dBm"), -63);
    assert.equal(numericCell("42%"), 42);
    assert.equal(numericCell("↓ 1 MB"), 1024 ** 2);
  });

  it("parses en-GB dates with and without a time", () => {
    const a = numericCell("09/07/2026, 22:35:14")!;
    const b = numericCell("10/07/2026")!;
    assert.ok(a < b);
  });

  it("rejects partly numeric strings so IPs and phones compare as text", () => {
    assert.equal(numericCell("192.168.1.10"), null);
    assert.equal(numericCell("07700 900000"), null);
    assert.equal(numericCell("Building 42"), null);
  });
});

describe("compareCells", () => {
  it("orders sizes by magnitude, not alphabetically", () => {
    assert.ok(compareCells("900 MB", "1.2 GB") < 0);
  });

  it("orders embedded numbers naturally", () => {
    assert.ok(compareCells("Building 2", "Building 10") < 0);
    assert.ok(compareCells("192.168.1.2", "192.168.1.10") < 0);
  });
});

describe("compareCellsDirected", () => {
  it("keeps empty cells last in both directions", () => {
    assert.ok(compareCellsDirected("-", "a", 1) > 0);
    assert.ok(compareCellsDirected("-", "a", -1) > 0);
    assert.ok(compareCellsDirected("a", "", 1) < 0);
    assert.equal(compareCellsDirected(null, "-", 1), 0);
  });

  it("flips only non-empty comparisons", () => {
    assert.ok(compareCellsDirected("a", "b", 1) < 0);
    assert.ok(compareCellsDirected("a", "b", -1) > 0);
  });

  it("empty detection covers null, blank and dash placeholders", () => {
    assert.ok(isEmptyCell(""));
    assert.ok(isEmptyCell(" - "));
    assert.ok(isEmptyCell(null));
    assert.ok(!isEmptyCell(0));
    assert.ok(!isEmptyCell("0"));
  });
});
