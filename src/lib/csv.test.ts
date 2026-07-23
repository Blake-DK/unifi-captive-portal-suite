import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toCSV } from "./csv.ts"; // explicit extension for Node's type-stripping runner

describe("toCSV", () => {
  it("quotes fields containing commas, quotes, newlines or semicolons", () => {
    const csv = toCSV(
      [{ a: "plain", b: 'has "quote", and comma' }],
      [{ key: "a", header: "A" }, { key: "b", header: "B" }],
    );
    assert.equal(csv, 'A,B\nplain,"has ""quote"", and comma"\n');
  });

  it("neutralises formula-injection payloads with a leading quote", () => {
    const rows = [
      { v: "=1+2" },
      { v: "+SUM(A1)" },
      { v: "-2" },
      { v: "@cmd" },
      { v: "\tTAB" },
    ];
    const cols = [{ key: "v" as const, header: "V" }];
    const lines = toCSV(rows, cols).trim().split("\n").slice(1);
    // Every dangerous prefix is now quoted-and-prefixed so a spreadsheet
    // treats it as text, not a formula.
    assert.equal(lines[0], "'=1+2");
    assert.equal(lines[1], "'+SUM(A1)");
    assert.equal(lines[2], "'-2");
    assert.equal(lines[3], "'@cmd");
    // A leading tab is neutralised by the prefix; a bare tab isn't a
    // CSV-structural char, so no extra quoting is added.
    assert.equal(lines[4], "'\tTAB");
  });

  it("leaves safe values untouched", () => {
    const csv = toCSV([{ v: "John Smith" }], [{ key: "v", header: "Name" }]);
    assert.equal(csv, "Name\nJohn Smith\n");
  });

  it("renders null/undefined as empty cells", () => {
    const csv = toCSV(
      [{ a: null, b: undefined }],
      [{ key: "a", header: "A" }, { key: "b", header: "B" }],
    );
    assert.equal(csv, "A,B\n,\n");
  });
});
