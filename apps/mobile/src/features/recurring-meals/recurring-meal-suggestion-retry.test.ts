import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  detectRecurringMealSuggestion,
  type RecurringMealSuggestionEntry,
} from "@mizyun/core";
import {
  recurringMealSuggestionProposalSchema,
  type RecurringMealSuggestionAccept,
  type RecurringMealSuggestionAcceptResponse,
} from "@mizyun/contracts";
vi.mock("@/features/log-meal/public-data", () => ({
  createOperationId: () => randomUUID(),
}));
import {
  RecurringSuggestionRetryStore,
  recurringSuggestionRetryKey,
  type SuggestionSecureStore,
} from "./recurring-meal-suggestion-retry";

const owner = "a2440000-0000-4000-8000-000000000090";
const otherOwner = "a2440000-0000-4000-8000-000000000091";
const entry = (day: number): RecurringMealSuggestionEntry => ({
  id: `b2440000-0000-4000-8000-${String(day).padStart(12, "0")}`,
  userId: owner,
  name: "Yogurt 150 g",
  consumedAt: `2026-10-${day}T08:00:00Z`,
  createdAt: `2026-10-${day}T08:01:00Z`,
  updatedAt: `2026-10-${day}T08:01:00Z`,
  confirmedByUser: true,
  caloriesKcal: 150,
  proteinG: 12,
  carbohydrateG: 15,
  fatG: 4,
  details: { grams: 150 },
});
const proposal = recurringMealSuggestionProposalSchema.parse(
  detectRecurringMealSuggestion({
    userId: owner,
    entries: [entry(11), entry(12), entry(13)],
    generatedEntryIds: [],
    historyComplete: true,
    referenceAt: new Date("2026-10-13T09:00:00Z"),
    timeZone: "UTC",
  }),
);
const input: RecurringMealSuggestionAccept = {
  operationId: "d2440000-0000-4000-8000-000000000090",
  proposal,
  localTime: proposal.localTime,
  timeZone: proposal.timeZone,
  weekdays: [...proposal.weekdays],
};
const nextInput: RecurringMealSuggestionAccept = {
  ...input,
  operationId: "d2440000-0000-4000-8000-000000000091",
};
const response: RecurringMealSuggestionAcceptResponse = {
  recurringMeal: {
    id: "c2440000-0000-4000-8000-000000000090",
    userId: owner,
    name: proposal.name,
    localTime: "08:00",
    timeZone: "UTC",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    enabled: true,
    createdAt: "2026-10-13T09:00:00Z",
    updatedAt: "2026-10-13T09:00:00Z",
  },
  created: true,
  startLocalDate: "2026-10-14",
};
function primitive() {
  const values = new Map<string, string>();
  const store: SuggestionSecureStore = {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      if (new TextEncoder().encode(value).byteLength > 2048)
        throw new Error("Native limit");
      values.set(key, value);
    },
    deleteItemAsync: async (key) => {
      values.delete(key);
    },
  };
  return { values, store, retry: new RecurringSuggestionRetryStore(store) };
}
function interruptDelete(store: SuggestionSecureStore, suffix: string) {
  const original = store.deleteItemAsync;
  let interrupted = false;
  store.deleteItemAsync = async (key) => {
    if (
      !interrupted &&
      key.startsWith(recurringSuggestionRetryKey(owner)) &&
      key.endsWith(suffix)
    ) {
      interrupted = true;
      throw new Error("Native delete interrupted");
    }
    return original(key);
  };
}

// Exercise actual chunk persistence and interruption boundaries, including restart.
describe("suggestion retry cleanup durability", () => {
  for (const suffix of [".1", ".manifest", ".cleanup"]) {
    it(`repairs explicit cleanup interrupted at ${suffix} on restart before allowing a fresh operation`, async () => {
      const { retry, store, values } = primitive();
      await retry.prepare(owner, input, () => true);
      await retry.prepare(otherOwner, input, () => true);
      interruptDelete(store, suffix);
      await expect(retry.clear(owner, input.operationId)).rejects.toThrow();
      expect(values.has(`${recurringSuggestionRetryKey(owner)}.cleanup`)).toBe(
        true,
      );

      const restarted = new RecurringSuggestionRetryStore(store);
      expect(await restarted.load(owner)).toBeNull();
      await expect(
        restarted.clear(owner, input.operationId),
      ).resolves.toBeUndefined();
      expect(
        [...values.keys()].some((key) =>
          key.startsWith(recurringSuggestionRetryKey(owner)),
        ),
      ).toBe(false);
      expect((await restarted.load(otherOwner))?.input).toEqual(input);
      expect(
        (await restarted.prepare(owner, nextInput, () => true)).input,
      ).toEqual(nextInput);
      await expect(restarted.clear(owner, input.operationId)).rejects.toThrow(
        "Recovery changed",
      );
      expect((await restarted.load(owner))?.input).toEqual(nextInput);
    });

    it(`retries the same expected-operation clear after ${suffix} without needing removed payload`, async () => {
      const { retry, store, values } = primitive();
      await retry.prepare(owner, input, () => true);
      interruptDelete(store, suffix);
      await expect(retry.clear(owner, input.operationId)).rejects.toThrow();
      const restarted = new RecurringSuggestionRetryStore(store);
      await expect(
        restarted.clear(owner, input.operationId),
      ).resolves.toBeUndefined();
      expect(values.size).toBe(0);
      await expect(
        restarted.clear(owner, input.operationId),
      ).resolves.toBeUndefined();
    });

    it(`finishes interrupted completed-receipt expiry cleanup at ${suffix}`, async () => {
      const { retry, store, values } = primitive();
      await retry.prepare(owner, input, () => true);
      await retry.complete(owner, input, response);
      const clock = vi
        .spyOn(Date, "now")
        .mockReturnValue(Date.now() + 8 * 86_400_000);
      try {
        const completed = await retry.load(owner);
        expect(completed?.completed).toEqual(response);
        expect(Date.now() - completed!.savedAt).toBeGreaterThan(7 * 86_400_000);
        interruptDelete(store, suffix);
        await expect(retry.clear(owner, input.operationId)).rejects.toThrow();
        const restarted = new RecurringSuggestionRetryStore(store);
        expect(await restarted.load(owner)).toBeNull();
        expect(values.size).toBe(0);
      } finally {
        clock.mockRestore();
      }
    });
  }

  it("rejects another operation before deleting intact or partially cleared recovery", async () => {
    const { retry, store, values } = primitive();
    await retry.prepare(owner, input, () => true);
    const original = new Map(values);
    await expect(retry.clear(owner, nextInput.operationId)).rejects.toThrow(
      "Recovery changed",
    );
    expect(values).toEqual(original);
    interruptDelete(store, ".1");
    await expect(retry.clear(owner, input.operationId)).rejects.toThrow();
    const partial = new Map(values);
    await expect(
      new RecurringSuggestionRetryStore(store).clear(
        owner,
        nextInput.operationId,
      ),
    ).rejects.toThrow("Recovery changed");
    expect(values).toEqual(partial);
    await retry.clear(owner, input.operationId);
    expect(values.size).toBe(0);
  });

  it("preserves an unknown attempt when the cleanup marker cannot be persisted", async () => {
    const { retry, store, values } = primitive();
    await retry.prepare(owner, input, () => true);
    const original = new Map(values);
    const set = store.setItemAsync;
    store.setItemAsync = async (key, value) => {
      if (key.endsWith(".cleanup")) throw new Error("Native write interrupted");
      return set(key, value);
    };
    await expect(retry.clear(owner, input.operationId)).rejects.toThrow(
      "Native write interrupted",
    );
    expect(values).toEqual(original);
    expect(
      await new RecurringSuggestionRetryStore(store).load(owner),
    ).toMatchObject({ input, completed: null });
  });

  it("preserves unknown outcomes across restart until explicit clear", async () => {
    const { retry, store } = primitive();
    await retry.prepare(owner, input, () => true);
    const restarted = new RecurringSuggestionRetryStore(store);
    expect(await restarted.load(owner)).toMatchObject({
      input,
      completed: null,
    });
    await expect(
      restarted.prepare(owner, nextInput, () => true),
    ).rejects.toThrow("previous setup");
    expect((await restarted.load(owner))?.input).toEqual(input);
  });

  it("repairs cleanup before prepare writes a fresh operation without requiring a load", async () => {
    const { retry, store } = primitive();
    await retry.prepare(owner, input, () => true);
    interruptDelete(store, ".1");
    await expect(retry.clear(owner, input.operationId)).rejects.toThrow();
    const restarted = new RecurringSuggestionRetryStore(store);
    expect(
      (await restarted.prepare(owner, nextInput, () => true)).input,
    ).toEqual(nextInput);
    expect((await restarted.load(owner))?.input).toEqual(nextInput);
  });

  it("keeps explicit erasure recoverable even when the payload is already incomplete", async () => {
    const { retry, store, values } = primitive();
    await retry.prepare(owner, input, () => true);
    const chunk = [...values.keys()].find((key) => key.endsWith(".0"))!;
    values.delete(chunk);
    interruptDelete(store, ".1");
    await expect(retry.clear(owner)).rejects.toThrow();
    await new RecurringSuggestionRetryStore(store).clear(owner);
    expect(values.size).toBe(0);
  });

  it("refuses a cleanup marker for a different generation without deleting the current attempt", async () => {
    const { retry, store, values } = primitive();
    await retry.prepare(owner, input, () => true);
    values.set(
      `${recurringSuggestionRetryKey(owner)}.cleanup`,
      JSON.stringify({
        generation: { id: randomUUID(), count: 1 },
        operationId: input.operationId,
      }),
    );
    const original = new Map(values);
    await expect(
      new RecurringSuggestionRetryStore(store).load(owner),
    ).rejects.toThrow("Recovery changed");
    expect(values).toEqual(original);
  });

  it("rejects an unbounded cleanup marker before attempting deletion", async () => {
    const { retry, store, values } = primitive();
    await retry.prepare(owner, input, () => true);
    const generation = JSON.parse(
      values.get(`${recurringSuggestionRetryKey(owner)}.manifest`)!,
    );
    values.set(
      `${recurringSuggestionRetryKey(owner)}.cleanup`,
      JSON.stringify({
        generation: { ...generation, count: 65 },
        operationId: input.operationId,
      }),
    );
    const original = new Map(values);
    await expect(
      new RecurringSuggestionRetryStore(store).load(owner),
    ).rejects.toThrow("Invalid recovery manifest");
    expect(values).toEqual(original);
  });

  it("retains 400-code-point payload chunks under historical 2048-byte native limits", async () => {
    const { retry, values } = primitive();
    const multibyte = {
      ...input,
      proposal: {
        ...proposal,
        name: "🥣".repeat(100),
        familyKey: "🥣".repeat(100),
      },
    };
    await retry.prepare(owner, multibyte, () => true);
    const chunks = [...values.entries()].filter(([key]) => /\.\d+$/.test(key));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThanOrEqual(64);
    for (const [, chunk] of chunks) {
      expect(Array.from(chunk).length).toBeLessThanOrEqual(400);
      expect(new TextEncoder().encode(chunk).byteLength).toBeLessThanOrEqual(
        2048,
      );
    }
    expect((await retry.load(owner))?.input).toEqual(multibyte);
    await retry.clear(owner, input.operationId);
    expect(values.size).toBe(0);
  });
});
