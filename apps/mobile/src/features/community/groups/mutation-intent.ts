/** Retain one operation identifier across an ambiguous response, scoped to exact intent. */
export function createGroupMutationIntentStore(newId: () => string) {
  const pending = new Map<string, { fingerprint: string; id: string }>();
  return {
    operationId(
      kind: "create" | "post",
      intent: Readonly<Record<string, unknown>>,
    ) {
      const fingerprint = JSON.stringify(intent);
      const current = pending.get(kind);
      if (current?.fingerprint === fingerprint) return current.id;
      const id = newId();
      pending.set(kind, { fingerprint, id });
      return id;
    },
    complete(kind: "create" | "post") {
      pending.delete(kind);
    },
    clear() {
      pending.clear();
    },
  };
}
