const listeners = new Set<(path: string) => void>();

/** Metadata on display results prevents saved reads being re-dated as live. */
export function isSavedDisplayResult(result: unknown): boolean {
  return typeof result === "object" && result !== null && "savedAt" in result;
}
export function savedDisplayTime(result: unknown): number | undefined {
  if (!isSavedDisplayResult(result)) return undefined;
  const value = (result as { savedAt: unknown }).savedAt;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Display refreshes only; this event never grants write or AI authority. */
export function subscribeSessionReadUpdates(
  listener: (path: string) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishSessionReadUpdate(path: string): void {
  for (const listener of listeners) listener(path);
}
