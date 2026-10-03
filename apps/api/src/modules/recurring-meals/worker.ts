/** Backend scheduling is independent of mobile foreground/background execution. */
export interface RecurringMealWorker {
  start(): void;
  close(): Promise<void>;
}
export const createRecurringMealWorker = (
  materialize: () => Promise<void>,
  onFailure: () => void,
  intervalMs = 60_000,
): RecurringMealWorker => {
  let timer: ReturnType<typeof setInterval> | null = null;
  let pending: Promise<void> | null = null;
  let closed = false;
  const tick = (): void => {
    if (closed || pending !== null) return;
    pending = Promise.resolve()
      .then(materialize)
      .catch(onFailure)
      .finally(() => {
        pending = null;
      });
  };
  return {
    start() {
      if (closed || timer !== null) return;
      tick();
      timer = setInterval(tick, intervalMs);
      timer.unref();
    },
    async close() {
      closed = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      await pending;
    },
  };
};
