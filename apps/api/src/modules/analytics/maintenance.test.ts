import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnalyticsRetentionWorker } from "./maintenance.js";
afterEach(() => vi.useRealTimers());
describe("analytics retention scheduling", () => {
  it("keeps 30 days fixed, serializes cleanup, retries and stops", async () => {
    vi.useFakeTimers();
    let resolve!: (n: number) => void;
    const cleanupExpired = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<number>((r) => {
            resolve = r;
          }),
      )
      .mockRejectedValueOnce(new Error("private diagnostic"))
      .mockResolvedValue(1);
    const failure = vi.fn();
    const worker = createAnalyticsRetentionWorker({ cleanupExpired }, failure);
    worker.start();
    worker.start();
    await vi.advanceTimersByTimeAsync(7_200_000);
    expect(cleanupExpired).toHaveBeenCalledTimes(1);
    expect(cleanupExpired).toHaveBeenCalledWith(30);
    resolve(1);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(failure).toHaveBeenCalledExactlyOnceWith();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(cleanupExpired).toHaveBeenCalledTimes(3);
    await worker.close();
    await vi.advanceTimersByTimeAsync(7_200_000);
    expect(cleanupExpired).toHaveBeenCalledTimes(3);
  });
  it("waits for a pending cleanup on shutdown", async () => {
    vi.useFakeTimers();
    let resolve!: (n: number) => void;
    const worker = createAnalyticsRetentionWorker(
      {
        cleanupExpired: () =>
          new Promise<number>((r) => {
            resolve = r;
          }),
      },
      vi.fn(),
    );
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    let closed = false;
    const closing = worker.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    resolve(0);
    await closing;
    expect(closed).toBe(true);
    worker.start();
  });
});
