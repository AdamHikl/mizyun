import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecurringMealWorker } from "./worker.js";
afterEach(() => vi.useRealTimers());
describe("recurring meal server worker", () => {
  it("does not overlap ticks, retries failures, and stops on shutdown", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const run = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const failure = vi.fn();
    const worker = createRecurringMealWorker(run, failure);
    worker.start();
    worker.start();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(failure).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(3);
    await worker.close();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(run).toHaveBeenCalledTimes(3);
  });
  it("waits for an in-flight transaction before shutdown completes", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const worker = createRecurringMealWorker(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      vi.fn(),
    );
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    let complete = false;
    const closing = worker.close().then(() => {
      complete = true;
    });
    await Promise.resolve();
    expect(complete).toBe(false);
    finish();
    await closing;
    expect(complete).toBe(true);
  });
});
