import { describe, expect, it } from "vitest";

import {
  clearLoggingDraft,
  eraseLoggingDraftForDeletedAccount,
  loadLoggingDraft,
  loadMealCompletionReceipt,
  loadRequiredLoggingDraft,
  saveLoggingDraft,
} from "./logging-draft-storage";

const USER_ID = "00000000-0000-4000-8000-000000000001";

const memoryStore = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      values.delete(key);
    },
  };
};

describe("logging draft storage", () => {
  it("stores drafts per user and removes them after success", async () => {
    const store = memoryStore();
    expect(
      await saveLoggingDraft(USER_ID, "meal", { name: "Toast" }, store),
    ).toBe(true);
    expect(
      await loadLoggingDraft(
        USER_ID,
        "meal",
        (value): value is { name: string } =>
          typeof value === "object" &&
          value !== null &&
          "name" in value &&
          typeof value.name === "string",
        store,
      ),
    ).toEqual({ name: "Toast" });
    expect(await clearLoggingDraft(USER_ID, "meal", store)).toBe(true);
    expect(store.values.size).toBe(0);
  });

  it("fails open when secure storage is unavailable or malformed", async () => {
    const failingStore = {
      getItemAsync: async (): Promise<string | null> => {
        throw new Error("unavailable");
      },
      setItemAsync: async (): Promise<void> => {
        throw new Error("unavailable");
      },
      deleteItemAsync: async (): Promise<void> => {
        throw new Error("unavailable");
      },
    };
    expect(
      await loadLoggingDraft(
        USER_ID,
        "weight",
        (_value): _value is Record<string, never> => false,
        failingStore,
      ),
    ).toBeNull();
    expect(
      await saveLoggingDraft(USER_ID, "weight", { weight: "72" }, failingStore),
    ).toBe(false);
    expect(await clearLoggingDraft(USER_ID, "weight", failingStore)).toBe(
      false,
    );
  });

  it("drops pending autosave if clear is called before save completes, preventing draft resurrection (Q2)", async () => {
    const store = memoryStore();
    let resolveSetItem = (): void => {};
    const slowStore = {
      ...store,
      setItemAsync: async (key: string, value: string) => {
        await new Promise<void>((resolve) => {
          resolveSetItem = resolve;
        });
        store.values.set(key, value);
      },
    };

    // 1. Initiate autosave (will block in slowStore.setItemAsync)
    const savePromise = saveLoggingDraft(
      USER_ID,
      "meal",
      { name: "In-flight meal" },
      slowStore,
    );

    // 2. Immediately call clearLoggingDraft (e.g. user submitted or pressed Clear)
    const clearPromise = clearLoggingDraft(USER_ID, "meal", store);

    // 3. Resolve the pending save
    resolveSetItem();

    const [saveResult, clearResult] = await Promise.all([
      savePromise,
      clearPromise,
    ]);

    // Save should return false (dropped due to generation bump by clear)
    expect(saveResult).toBe(false);
    expect(clearResult).toBe(true);

    // Storage must NOT contain the draft!
    const loaded = await loadLoggingDraft(
      USER_ID,
      "meal",
      (v): v is { name: string } => true,
      store,
    );
    expect(loaded).toBeNull();
  });
});

describe("required running draft recovery", () => {
  const valid = (value: unknown): value is { pending: string } =>
    !!value && typeof value === "object" && "pending" in value;
  it("keeps pending run slots account scoped and only treats confirmed absence as empty", async () => {
    const store = memoryStore();
    await saveLoggingDraft(
      USER_ID,
      "run",
      { pending: "immutable-operation" },
      store,
    );
    expect(
      await loadRequiredLoggingDraft(USER_ID, "run", valid, store),
    ).toEqual({ pending: "immutable-operation" });
    expect(
      await loadRequiredLoggingDraft("other-user", "run", valid, store),
    ).toBeNull();
  });
  it("rejects unavailable reads and malformed drafts instead of starting another operation", async () => {
    const store = memoryStore();
    store.getItemAsync = async () => {
      throw new Error("locked");
    };
    await expect(
      loadRequiredLoggingDraft(USER_ID, "run", valid, store),
    ).rejects.toThrow("locked");
    store.getItemAsync = async () => "{broken";
    await expect(
      loadRequiredLoggingDraft(USER_ID, "run", valid, store),
    ).rejects.toThrow();
    store.getItemAsync = async () => JSON.stringify({ other: "value" });
    await expect(
      loadRequiredLoggingDraft(USER_ID, "run", valid, store),
    ).rejects.toThrow("unavailable");
  });
});

it("autosave preserves an outcome-unknown frozen meal body and rejects replacement identity", async () => {
  const store = memoryStore();
  const frozen = {
    name: "Meal",
    clientOperationId: USER_ID,
    consumedAt: "2026-09-08T12:00:00.000Z",
    caloriesKcal: 200,
    proteinG: null,
    carbohydrateG: 0,
    fatG: null,
  };
  const pending = {
    name: "Meal",
    clientOperationId: USER_ID,
    consumedAt: frozen.consumedAt,
    submissionStatus: "outcome_unknown",
    submittedMeal: frozen,
  };
  await saveLoggingDraft(USER_ID, "meal", pending, store);
  expect(
    await saveLoggingDraft(
      USER_ID,
      "meal",
      { name: "Changed", clientOperationId: USER_ID, consumedAt: "new time" },
      store,
    ),
  ).toBe(true);
  const raw = JSON.parse([...store.values.values()][0]!);
  expect(raw.submittedMeal).toEqual(frozen);
  expect(raw.consumedAt).toBe(frozen.consumedAt);
  expect(
    await saveLoggingDraft(
      USER_ID,
      "meal",
      {
        name: "Replacement",
        clientOperationId: "00000000-0000-4000-8000-000000000002",
      },
      store,
    ),
  ).toBe(false);
  expect(await clearLoggingDraft(USER_ID, "meal", store)).toBe(false);
  expect(
    await clearLoggingDraft(USER_ID, "meal", store, {
      resolvedOperationId: USER_ID,
    }),
  ).toBe(true);
});

it("exports only validated owner-scoped completion receipts and keeps corrupt recovery explicit", async () => {
  const { loadMealCompletionReceipt } = await import("./logging-draft-storage");
  const store = memoryStore();
  expect(await loadMealCompletionReceipt(USER_ID, store)).toBeNull();
  await saveLoggingDraft(
    USER_ID,
    "meal-completed",
    { operationIds: [USER_ID] },
    store,
  );
  expect(await loadMealCompletionReceipt(USER_ID, store)).toEqual({
    operationIds: [USER_ID],
  });
  expect(await loadMealCompletionReceipt("another-owner", store)).toBeNull();
  await saveLoggingDraft(
    USER_ID,
    "meal-completed",
    { operationIds: ["invalid"] },
    store,
  );
  await expect(loadMealCompletionReceipt(USER_ID, store)).rejects.toThrow(
    "unavailable",
  );
});

it("reserves forced erasure of an ambiguous meal for explicit deleted-account cleanup", async () => {
  const { eraseLoggingDraftForDeletedAccount } =
    await import("./logging-draft-storage");
  const store = memoryStore();
  await saveLoggingDraft(
    USER_ID,
    "meal",
    {
      name: "Meal",
      clientOperationId: USER_ID,
      submissionStatus: "outcome_unknown",
      submittedMeal: { clientOperationId: USER_ID },
    },
    store,
  );
  expect(await clearLoggingDraft(USER_ID, "meal", store)).toBe(false);
  expect(await eraseLoggingDraftForDeletedAccount(USER_ID, "meal", store)).toBe(
    true,
  );
  expect(store.values.size).toBe(0);
});

it.each(["save", "clear"] as const)(
  "deleted-account cleanup retires an in-flight completion receipt from resolved %s",
  async (action) => {
    const store = memoryStore();
    const receiptKey = `mizyun.logging-draft.${USER_ID}.meal-completed`;
    let release!: () => void;
    let entered!: () => void;
    const began = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const heldStore = {
      ...store,
      setItemAsync: async (key: string, value: string) => {
        if (key === receiptKey) {
          entered();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        await store.setItemAsync(key, value);
      },
    };
    await saveLoggingDraft(
      USER_ID,
      "meal",
      {
        clientOperationId: USER_ID,
        submissionStatus: "outcome_unknown",
        submittedMeal: { clientOperationId: USER_ID },
      },
      store,
    );
    // Account cleanup precedes sign-out, so the screen context still appears current.
    const options = { resolvedOperationId: USER_ID, isCurrent: () => true };
    const completion =
      action === "save"
        ? saveLoggingDraft(
            USER_ID,
            "meal",
            { name: "Next meal" },
            heldStore,
            options,
          )
        : clearLoggingDraft(USER_ID, "meal", heldStore, options);
    await began;
    const erasures = Promise.all([
      eraseLoggingDraftForDeletedAccount(USER_ID, "meal", heldStore),
      eraseLoggingDraftForDeletedAccount(USER_ID, "meal-completed", heldStore),
    ]);
    // Let independently queued native deletes finish while the receipt set is held.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    release();
    expect(await erasures).toEqual([true, true]);
    expect(await completion).toBe(false);
    expect(await loadMealCompletionReceipt(USER_ID, store)).toBeNull();
    expect(store.values.size).toBe(0);
  },
);

it("removes a retired receipt write even when the meal generation stays current", async () => {
  const store = memoryStore();
  const receiptKey = `mizyun.logging-draft.${USER_ID}.meal-completed`;
  let release!: () => void;
  let entered!: () => void;
  const began = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const heldStore = {
    ...store,
    setItemAsync: async (key: string, value: string) => {
      if (key === receiptKey) {
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      await store.setItemAsync(key, value);
    },
  };
  const pending = {
    clientOperationId: USER_ID,
    submissionStatus: "outcome_unknown",
    submittedMeal: { clientOperationId: USER_ID },
  };
  await saveLoggingDraft(USER_ID, "meal", pending, store);
  const completion = clearLoggingDraft(USER_ID, "meal", heldStore, {
    resolvedOperationId: USER_ID,
    isCurrent: () => true,
  });
  await began;
  const erased = eraseLoggingDraftForDeletedAccount(
    USER_ID,
    "meal-completed",
    heldStore,
  );
  release();
  expect(await completion).toBe(false);
  expect(await erased).toBe(true);
  expect(await loadMealCompletionReceipt(USER_ID, store)).toBeNull();
  expect(
    await loadRequiredLoggingDraft(
      USER_ID,
      "meal",
      (value): value is typeof pending =>
        !!value && typeof value === "object" && "clientOperationId" in value,
      store,
    ),
  ).toEqual(pending);
});

it("retains the latest 32 distinct completions within the same owner", async () => {
  const store = memoryStore();
  const operationIds = Array.from(
    { length: 32 },
    (_, index) =>
      `00000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`,
  );
  await saveLoggingDraft(USER_ID, "meal-completed", { operationIds }, store);
  const nextOperationId = "00000000-0000-4000-8000-000000000033";
  expect(
    await clearLoggingDraft(USER_ID, "meal", store, {
      resolvedOperationId: nextOperationId,
    }),
  ).toBe(true);
  expect(await loadMealCompletionReceipt(USER_ID, store)).toEqual({
    operationIds: [...operationIds.slice(1), nextOperationId],
  });
  const repeatedOperationId = operationIds[16]!;
  expect(
    await clearLoggingDraft(USER_ID, "meal", store, {
      resolvedOperationId: repeatedOperationId,
    }),
  ).toBe(true);
  expect(await loadMealCompletionReceipt(USER_ID, store)).toEqual({
    operationIds: [
      ...operationIds.slice(1).filter((id) => id !== repeatedOperationId),
      nextOperationId,
      repeatedOperationId,
    ],
  });
  expect(await loadMealCompletionReceipt("another-owner", store)).toBeNull();
});

it("invalidates an async comparison when Clear is scheduled before its write", async () => {
  const { updateLoggingDraft } = await import("./logging-draft-storage");
  const store = memoryStore();
  let release!: () => void;
  let entered!: () => void;
  const began = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = updateLoggingDraft(
    USER_ID,
    "meal",
    async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { result: "ready", value: { name: "Stale handoff" } };
    },
    store,
  );
  const rejection = expect(pending).rejects.toThrow("context changed");
  await began;
  const cleared = clearLoggingDraft(USER_ID, "meal", store);
  release();
  await rejection;
  expect(await cleared).toBe(true);
  expect(store.values.size).toBe(0);
});
