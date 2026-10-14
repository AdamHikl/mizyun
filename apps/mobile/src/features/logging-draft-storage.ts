import * as SecureStore from "expo-secure-store";

export type LoggingDraftKind =
  | "meal"
  | "meal-completed"
  | "workout"
  | "weight"
  | "coach"
  | "run"
  | `meal-edit-${string}`
  | `meal-photo-${string}`;

export interface SecureKeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync(key: string): Promise<unknown>;
}

const draftKey = (userId: string, kind: LoggingDraftKind): string =>
  `mizyun.logging-draft.${userId}.${kind}`;

export const loadLoggingDraft = async <T>(
  userId: string,
  kind: LoggingDraftKind,
  isDraft: (value: unknown) => value is T,
  store: SecureKeyValueStore = SecureStore,
): Promise<T | null> => {
  try {
    const raw = await store.getItemAsync(draftKey(userId, kind));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) ? parsed : null;
  } catch {
    // Draft recovery is best effort and must never block logging.
    return null;
  }
};

/** Pending mutations must distinguish empty storage from an unavailable/corrupt read. */
export const loadRequiredLoggingDraft = async <T>(
  userId: string,
  kind: LoggingDraftKind,
  isDraft: (value: unknown) => value is T,
  store: SecureKeyValueStore = SecureStore,
): Promise<T | null> => {
  const raw = await store.getItemAsync(draftKey(userId, kind));
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!isDraft(parsed)) throw new Error("The saved draft is unavailable.");
  return parsed;
};

const writeQueues = new Map<string, Promise<unknown>>();
const storageGenerations = new Map<string, number>();

const enqueueWrite = <T>(key: string, task: () => Promise<T>): Promise<T> => {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  writeQueues.set(key, current);
  void current.then(
    () => {
      if (writeQueues.get(key) === current) {
        writeQueues.delete(key);
      }
    },
    () => {
      if (writeQueues.get(key) === current) writeQueues.delete(key);
    },
  );
  return current;
};

export interface DraftWriteOptions {
  readonly isCurrent?: () => boolean;
  /** Only a confirmed successful mutation can release its frozen slot. */
  readonly resolvedOperationId?: string;
}

const unknownMeal = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") return null;
  const draft = value as Record<string, unknown>;
  return draft.submissionStatus === "outcome_unknown" ? draft : null;
};

/** Serialize comparison and mutation with autosaves, clears and other handoffs. */
export const updateLoggingDraft = async <T>(
  userId: string,
  kind: LoggingDraftKind,
  update: (
    value: unknown,
  ) =>
    | { readonly result: T; readonly value?: object }
    | Promise<{ readonly result: T; readonly value?: object }>,
  store: SecureKeyValueStore = SecureStore,
  isCurrent: () => boolean = () => true,
): Promise<T> => {
  const key = draftKey(userId, kind);
  const generation = storageGenerations.get(key) ?? 0;
  return enqueueWrite(key, async () => {
    if (!isCurrent() || generation !== (storageGenerations.get(key) ?? 0))
      throw new Error("Draft context changed.");
    const raw = await store.getItemAsync(key);
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!isCurrent()) throw new Error("Draft context changed.");
    const next = await update(value);
    if (!isCurrent() || generation !== (storageGenerations.get(key) ?? 0))
      throw new Error("Draft context changed.");
    if (next.value !== undefined) {
      if (!isCurrent()) throw new Error("Draft context changed.");
      await store.setItemAsync(key, JSON.stringify(next.value));
    }
    return next.result;
  });
};

export interface MealCompletionReceipt {
  readonly operationIds: readonly string[];
}
export const isMealCompletionReceipt = (
  value: unknown,
): value is MealCompletionReceipt => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 1 &&
    Array.isArray(record.operationIds) &&
    record.operationIds.length <= 32 &&
    record.operationIds.every(
      (id) =>
        typeof id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          id,
        ),
    )
  );
};
export const loadMealCompletionReceipt = (
  userId: string,
  store: SecureKeyValueStore = SecureStore,
): Promise<MealCompletionReceipt | null> =>
  loadRequiredLoggingDraft(
    userId,
    "meal-completed",
    isMealCompletionReceipt,
    store,
  );

/** Meal mutations wait on this queue; receipt mutations never wait on the meal queue. */
const recordMealCompletion = async (
  userId: string,
  operationId: string,
  store: SecureKeyValueStore,
  isCurrent: () => boolean,
): Promise<void> => {
  const key = draftKey(userId, "meal-completed");
  const generation = storageGenerations.get(key) ?? 0;
  const isReceiptCurrent = () =>
    isCurrent() && generation === (storageGenerations.get(key) ?? 0);
  await enqueueWrite(key, async () => {
    if (!isReceiptCurrent()) throw new Error("Draft context changed.");
    const previous = await loadRequiredLoggingDraft(
      userId,
      "meal-completed",
      isMealCompletionReceipt,
      store,
    );
    if (!isReceiptCurrent()) throw new Error("Draft context changed.");
    const receipt: MealCompletionReceipt = {
      operationIds: [
        ...(previous?.operationIds ?? []).filter((id) => id !== operationId),
        operationId,
      ].slice(-32),
    };
    if (!isMealCompletionReceipt(receipt))
      throw new Error("Invalid completed operation.");
    await store.setItemAsync(key, JSON.stringify(receipt));
    if (!isReceiptCurrent()) {
      // The native write may finish after deletion or session retirement begins.
      // Remove it while holding the receipt queue, before newer mutations can run.
      await store.deleteItemAsync(key);
      throw new Error("Draft context changed.");
    }
  });
};

export const saveLoggingDraft = async <T extends object>(
  userId: string,
  kind: LoggingDraftKind,
  value: T,
  store: SecureKeyValueStore = SecureStore,
  options: DraftWriteOptions = {},
): Promise<boolean> => {
  const key = draftKey(userId, kind);
  const scheduledGen = storageGenerations.get(key) ?? 0;
  return enqueueWrite(key, async () => {
    if (
      (storageGenerations.get(key) ?? 0) !== scheduledGen ||
      options.isCurrent?.() === false
    )
      return false;
    try {
      let next: object = value;
      if (kind === "meal") {
        const raw = await store.getItemAsync(key);
        const stored: unknown = raw === null ? null : JSON.parse(raw);
        const pending = unknownMeal(stored);
        if (
          options.resolvedOperationId &&
          stored !== null &&
          (!stored ||
            typeof stored !== "object" ||
            (stored as Record<string, unknown>).clientOperationId !==
              options.resolvedOperationId)
        )
          return false;
        if (
          pending &&
          options.resolvedOperationId !== pending.clientOperationId
        ) {
          const candidate = value as Record<string, unknown>;
          if (candidate.clientOperationId !== pending.clientOperationId)
            return false;
          if (
            candidate.submittedMeal !== undefined &&
            JSON.stringify(candidate.submittedMeal) !==
              JSON.stringify(pending.submittedMeal)
          )
            return false;
          next = {
            ...candidate,
            clientOperationId: pending.clientOperationId,
            consumedAt: pending.consumedAt,
            submittedMeal: pending.submittedMeal,
            submissionStatus: "outcome_unknown",
          };
        }
      }
      if (
        options.isCurrent?.() === false ||
        scheduledGen !== (storageGenerations.get(key) ?? 0)
      )
        return false;
      if (kind === "meal" && options.resolvedOperationId)
        await recordMealCompletion(
          userId,
          options.resolvedOperationId,
          store,
          () =>
            options.isCurrent?.() !== false &&
            scheduledGen === (storageGenerations.get(key) ?? 0),
        );
      if (
        options.isCurrent?.() === false ||
        scheduledGen !== (storageGenerations.get(key) ?? 0)
      )
        return false;
      await store.setItemAsync(key, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  });
};

export const clearLoggingDraft = async (
  userId: string,
  kind: LoggingDraftKind,
  store: SecureKeyValueStore = SecureStore,
  options: DraftWriteOptions = {},
): Promise<boolean> => {
  const key = draftKey(userId, kind);
  const nextGen = (storageGenerations.get(key) ?? 0) + 1;
  storageGenerations.set(key, nextGen);
  return enqueueWrite(key, async () => {
    try {
      if (options.isCurrent?.() === false) return false;
      if (kind === "meal") {
        const raw = await store.getItemAsync(key);
        const stored: unknown = raw === null ? null : JSON.parse(raw);
        if (
          options.resolvedOperationId &&
          stored !== null &&
          (!stored ||
            typeof stored !== "object" ||
            (stored as Record<string, unknown>).clientOperationId !==
              options.resolvedOperationId)
        )
          return false;
        const pending = unknownMeal(stored);
        if (
          pending &&
          options.resolvedOperationId !== pending.clientOperationId
        )
          return false;
      }
      if (options.isCurrent?.() === false) return false;
      if (kind === "meal" && options.resolvedOperationId)
        await recordMealCompletion(
          userId,
          options.resolvedOperationId,
          store,
          () =>
            options.isCurrent?.() !== false &&
            nextGen === (storageGenerations.get(key) ?? 0),
        );
      if (options.isCurrent?.() === false) return false;
      await store.deleteItemAsync(key);
      return true;
    } catch {
      return false;
    }
  });
};

/** Account deletion cleanup only; ordinary Clear must preserve unknown mutations. */
export const eraseLoggingDraftForDeletedAccount = async (
  userId: string,
  kind: LoggingDraftKind,
  store: SecureKeyValueStore = SecureStore,
): Promise<boolean> => {
  const key = draftKey(userId, kind);
  storageGenerations.set(key, (storageGenerations.get(key) ?? 0) + 1);
  return enqueueWrite(key, async () => {
    try {
      await store.deleteItemAsync(key);
      return true;
    } catch {
      return false;
    }
  });
};
