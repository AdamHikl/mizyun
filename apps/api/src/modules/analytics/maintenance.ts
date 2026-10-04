import type { ProductAnalyticsRepository } from "@mizyun/core";

/** Fixed retention; runs with server-owned privileges, never caller input. */
export function createAnalyticsRetentionWorker(
  repository: Pick<ProductAnalyticsRepository, "cleanupExpired">,
  onFailure: () => void,
) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let pending: Promise<unknown> | null = null;
  let closed = false;
  const tick = () => {
    if (closed || pending) return;
    pending = Promise.resolve()
      .then(() => repository.cleanupExpired(30))
      .catch(() => {
        try {
          onFailure();
        } catch {
          /* Diagnostics cannot stop retention scheduling. */
        }
      })
      .finally(() => {
        pending = null;
      });
  };
  return {
    start() {
      if (closed || timer) return;
      tick();
      timer = setInterval(tick, 3_600_000);
      timer.unref();
    },
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      timer = null;
      await pending;
    },
  };
}
