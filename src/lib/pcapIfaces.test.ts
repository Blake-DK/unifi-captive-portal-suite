import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTcpdumpInterfaces } from "./pcapIfaces.ts"; // explicit extension for Node's type-stripping runner

describe("parseTcpdumpInterfaces", () => {
  it("parses modern output with state flags, dropping pseudo-devices", () => {
    const out = [
      "1.eth0 [Up, Running, Connected]",
      "2.switch0 [Up, Running]",
      "3.any (Pseudo-device that captures on all interfaces) [Up, Running]",
      "4.lo [Up, Running, Loopback]",
      "5.nflog (Linux netfilter log (NFLOG) interface) [none]",
      "6.usbmon1 (Raw USB traffic, bus number 1)",
    ].join("\n");
    assert.deepEqual(parseTcpdumpInterfaces(out), [
      { name: "eth0", note: "Up, Running, Connected" },
      { name: "switch0", note: "Up, Running" },
      { name: "any", note: "Up, Running" },
    ]);
  });
  it("parses bare old-format lines without flags or descriptions", () => {
    assert.deepEqual(parseTcpdumpInterfaces("1.eth0\n2.ath0\n3.br0"), [
      { name: "eth0", note: null },
      { name: "ath0", note: null },
      { name: "br0", note: null },
    ]);
  });
  it("returns nothing for shell errors and banners", () => {
    assert.deepEqual(parseTcpdumpInterfaces("sh: tcpdump: not found"), []);
    assert.deepEqual(parseTcpdumpInterfaces(""), []);
  });
});
