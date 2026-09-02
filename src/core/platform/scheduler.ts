/**
 * Timer injection.
 *
 * `src/core` is compiled with no ambient `types`, so it cannot reach for
 * `setInterval` as a global. That constraint turns out to be useful: taking a
 * scheduler as a dependency is what lets a test drive a whole simulated flight
 * in microseconds instead of waiting for real timers.
 */

export type TimerHandle = unknown;

export interface Scheduler {
  setInterval(handler: () => void, intervalMs: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
  setTimeout(handler: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

interface GlobalTimers {
  setInterval(handler: () => void, timeout: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
  setTimeout(handler: () => void, timeout: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

const globalTimers = globalThis as unknown as GlobalTimers;

/** The host's real timers. Used everywhere except in tests. */
export const systemScheduler: Scheduler = {
  setInterval: (handler, intervalMs) => globalTimers.setInterval(handler, intervalMs),
  clearInterval: (handle) => globalTimers.clearInterval(handle),
  setTimeout: (handler, delayMs) => globalTimers.setTimeout(handler, delayMs),
  clearTimeout: (handle) => globalTimers.clearTimeout(handle),
};

/**
 * A scheduler that never fires on its own.
 *
 * Hand it to a link in a test, then step the link by hand. Nothing is left
 * running when the test finishes, so a forgotten `close()` cannot leak a timer
 * into the next test file.
 */
export class ManualScheduler implements Scheduler {
  private handle = 0;

  private readonly intervals = new Map<number, { handler: () => void; intervalMs: number }>();

  private readonly timeouts = new Map<number, { handler: () => void; delayMs: number }>();

  setInterval(handler: () => void, intervalMs: number): TimerHandle {
    this.handle += 1;
    this.intervals.set(this.handle, { handler, intervalMs });
    return this.handle;
  }

  clearInterval(handle: TimerHandle): void {
    this.intervals.delete(handle as number);
  }

  setTimeout(handler: () => void, delayMs: number): TimerHandle {
    this.handle += 1;
    this.timeouts.set(this.handle, { handler, delayMs });
    return this.handle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timeouts.delete(handle as number);
  }

  /** Fire every registered interval `times` times, in registration order. */
  runIntervals(times = 1): void {
    for (let i = 0; i < times; i += 1) {
      for (const entry of [...this.intervals.values()]) entry.handler();
    }
  }

  /** Fire and discard every pending timeout. */
  runTimeouts(): void {
    for (const [key, entry] of [...this.timeouts.entries()]) {
      this.timeouts.delete(key);
      entry.handler();
    }
  }

  /** Number of live intervals. A leak check for tests. */
  get activeIntervals(): number {
    return this.intervals.size;
  }
}
