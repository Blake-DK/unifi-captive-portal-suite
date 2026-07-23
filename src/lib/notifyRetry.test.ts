import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withRetries } from "./notifyRetry.ts"; // explicit extension for Node's type-stripping runner

const noSleep = async () => {};

describe("withRetries", () => {
  it("returns after the first success", async () => {
    let calls = 0;
    const r = await withRetries(async () => {
      calls++;
    });
    assert.deepEqual(r, { ok: true, attempts: 1 });
    assert.equal(calls, 1);
  });

  it("retries through failures and reports the recovery attempt", async () => {
    let calls = 0;
    const r = await withRetries(
      async () => {
        if (++calls < 3) throw new Error(`boom ${calls}`);
      },
      { sleeper: noSleep },
    );
    assert.deepEqual(r, { ok: true, attempts: 3 });
  });

  it("gives up after the bound with the last error", async () => {
    const waits: number[] = [];
    const r = await withRetries(
      async () => {
        throw new Error("still down");
      },
      { attempts: 3, backoffMs: [5, 25], sleeper: async (ms) => void waits.push(ms) },
    );
    assert.equal(r.ok, false);
    assert.equal(r.attempts, 3);
    assert.equal(r.lastError, "still down");
    assert.deepEqual(waits, [5, 25], "backoff between attempts, none after the last");
  });
});
