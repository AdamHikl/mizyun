import { describe, expect, it, vi } from "vitest";
import type { FoodEntry } from "@mizyun/contracts";
vi.mock("expo-secure-store", () => ({}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000123",
}));
vi.mock("@/composition/api-client", () => ({ apiClient: {} }));
vi.mock("@/features/health-exports", () => ({}));
vi.mock("../log-meal/meal-photo-retention", () => ({
  clearAllMealPhotoRetries: vi.fn(),
}));
import {
  prepareQuickMealRepeat,
  completeQuickMealRepeat,
  clearQuickMealRepeat,
  loadQuickMealRepeat,
  type QuickMealRepeatStore,
} from "./quick-meal-repeat";

const source = {
  id: "source",
  name: "Synthetic breakfast",
  caloriesKcal: 200,
  proteinG: 5,
  carbohydrateG: 30,
  fatG: 4,
  fibreG: 3,
  details: { recurringMeal: { id: "schedule" }, note: "original" },
} as unknown as FoodEntry;
function memoryStore() {
  const records = new Map<string, string>();
  const store: QuickMealRepeatStore = {
    getItemAsync: vi.fn(async (key) => records.get(key) ?? null),
    setItemAsync: vi.fn(async (key, value) => {
      records.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key) => {
      records.delete(key);
    }),
  };
  return { store, records };
}
const now = () => new Date("2026-10-04T08:00:00Z");
describe("secure quick meal repeat operation", () => {
  it("uses one bounded record and never exposes another day's pending meal", async () => {
    const { store, records } = memoryStore();
    await prepareQuickMealRepeat(
      "bounded-owner",
      "2026-10-04",
      source,
      false,
      store,
      now,
    );
    expect(
      await loadQuickMealRepeat("bounded-owner", "2026-10-05", store),
    ).toBeNull();
    await prepareQuickMealRepeat(
      "bounded-owner",
      "2026-10-05",
      source,
      false,
      store,
      () => new Date("2026-10-05T08:00:00Z"),
    );
    expect(records.size).toBe(1);
  });

  it("account deletion waits behind pending persistence and prevents its reintroduction", async () => {
    const { store, records } = memoryStore();
    let finish!: () => void;
    let started!: () => void;
    const writing = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(store.setItemAsync).mockImplementationOnce(async (key, value) => {
      started();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      records.set(key, value);
    });
    const prepare = prepareQuickMealRepeat(
      "deleted-owner",
      "2026-10-04",
      source,
      false,
      store,
      now,
    );
    const rejected = expect(prepare).rejects.toThrow("deleted");
    await writing;
    const cleanup = clearQuickMealRepeat("deleted-owner", store);
    finish();
    await rejected;
    await cleanup;
    expect(records.size).toBe(0);
    await expect(
      prepareQuickMealRepeat(
        "deleted-owner",
        "2026-10-04",
        source,
        false,
        store,
        now,
      ),
    ).rejects.toThrow("deleted");
    expect(records.size).toBe(0);
  });

  it("persists before returning and concurrent preparations share the same operation", async () => {
    const { store } = memoryStore();
    const [first, concurrent] = await Promise.all([
      prepareQuickMealRepeat("owner", "2026-10-04", source, false, store, now),
      prepareQuickMealRepeat(
        "owner",
        "2026-10-04",
        { ...source, name: "Edited" },
        false,
        store,
        now,
      ),
    ]);
    expect(concurrent).toEqual(first);
    expect(store.setItemAsync).toHaveBeenCalledTimes(1);
    if (first.completed) throw new Error("Unexpected completion");
    expect(first.payload.details).toEqual({ note: "original" });
    expect(first.payload.fibreG).toBeUndefined();
  });
  it("restores the original source and timestamp after a lost response or remount", async () => {
    const { store } = memoryStore();
    const first = await prepareQuickMealRepeat(
      "owner",
      "2026-10-04",
      source,
      true,
      store,
      now,
    );
    const retry = await prepareQuickMealRepeat(
      "owner",
      "2026-10-04",
      { ...source, id: "other", name: "Edited", details: {} },
      false,
      store,
      () => new Date("2026-10-04T12:00:00Z"),
    );
    expect(retry).toEqual(first);
    if (retry.completed) throw new Error("Unexpected completion");
    expect(retry.payload.fibreG).toBe(3);
    expect(retry.payload.consumedAt).toBe("2026-10-04T08:00:00.000Z");
  });
  it("scopes pending records by owner and day and rejects wrong-owner stored data", async () => {
    const { store, records } = memoryStore();
    await prepareQuickMealRepeat(
      "owner",
      "2026-10-04",
      source,
      false,
      store,
      now,
    );
    const other = await prepareQuickMealRepeat(
      "second",
      "2026-10-04",
      { ...source, name: "Second meal" },
      false,
      store,
      now,
    );
    if (other.completed) throw new Error("Unexpected completion");
    expect(other.payload.name).toBe("Second meal");
    const raw = [...records.values()][0];
    records.set("mizyun.quick-meal-repeat.third", raw);
    await expect(
      prepareQuickMealRepeat("third", "2026-10-04", source, false, store, now),
    ).rejects.toThrow();
  });
  it("fails closed on corrupt hydration and rejected persistence", async () => {
    const { store, records } = memoryStore();
    records.set("mizyun.quick-meal-repeat.owner", "corrupt");
    await expect(
      prepareQuickMealRepeat("owner", "2026-10-04", source, false, store, now),
    ).rejects.toThrow();
    expect(store.setItemAsync).not.toHaveBeenCalled();
    records.clear();
    vi.mocked(store.setItemAsync).mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    await expect(
      prepareQuickMealRepeat("owner", "2026-10-04", source, false, store, now),
    ).rejects.toThrow();
  });
  it("does not delete a different retained operation", async () => {
    const { store } = memoryStore();
    const pending = await prepareQuickMealRepeat(
      "owner",
      "2026-10-04",
      source,
      false,
      store,
      now,
    );
    if (pending.completed) throw new Error("Unexpected completion");
    await expect(
      completeQuickMealRepeat(
        {
          ...pending,
          payload: {
            ...pending.payload,
            clientOperationId: "00000000-0000-4000-8000-000000000456",
          },
        },
        store,
      ),
    ).rejects.toThrow();
    expect(store.deleteItemAsync).not.toHaveBeenCalled();
    await completeQuickMealRepeat(pending, store);
    expect(store.deleteItemAsync).not.toHaveBeenCalled();
    const recovered = await prepareQuickMealRepeat(
      "owner",
      "2026-10-04",
      source,
      false,
      store,
      now,
    );
    expect(recovered).toEqual({
      owner: "owner",
      localDate: "2026-10-04",
      operationId: pending.payload.clientOperationId,
      completed: true,
    });
    expect(JSON.stringify(recovered)).not.toContain("breakfast");
  });
});
