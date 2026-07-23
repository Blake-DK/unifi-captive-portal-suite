/**
 * Tiny FIFO semaphore, no dependencies. Puts a hard ceiling on concurrent
 * calls to a slow external system (the UniFi controller) so a burst degrades
 * into queueing latency instead of a pile of parallel requests and timeouts.
 */
export class Semaphore {
  private readonly waiters: (() => void)[] = [];
  private active = 0;
  // No parameter property: Node's strip-only TS runner can't parse those.
  private readonly limit: number;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`invalid semaphore limit: ${limit}`);
    }
    this.limit = limit;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    // The waiters check keeps FIFO order: a fresh caller must not overtake
    // the queue even when a slot happens to be free at this instant.
    if (this.active < this.limit && this.waiters.length === 0) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    // Hand the slot straight to the next waiter (it stays counted in
    // `active`); decrementing first would open a window for queue-jumping.
    if (next) next();
    else this.active--;
  }
}
