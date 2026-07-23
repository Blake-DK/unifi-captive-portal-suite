import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { Semaphore } = await import("./semaphore.ts"); // explicit extension for Node's type-stripping runner

describe("Semaphore", () => {
  it("caps concurrency at the limit and keeps FIFO order", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        sem.run(async () => {
          active++;
          peak = Math.max(peak, active);
          started.push(i);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    assert.equal(peak, 2);
    assert.equal(active, 0);
    assert.deepEqual(started, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("releases the slot when the task throws", async () => {
    const sem = new Semaphore(1);
    await assert.rejects(
      sem.run(async () => {
        throw new Error("boom");
      }),
      /boom/,
    );
    let ran = false;
    await sem.run(async () => {
      ran = true;
    });
    assert.ok(ran);
  });

  it("rejects a nonsensical limit", () => {
    assert.throws(() => new Semaphore(0));
    assert.throws(() => new Semaphore(1.5));
  });
});
