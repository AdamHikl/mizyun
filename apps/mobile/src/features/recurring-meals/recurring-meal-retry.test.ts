import { describe, expect, it, vi } from "vitest";
vi.mock("expo-secure-store", () => ({}));
vi.mock("@/features/log-meal/public-data", () => ({
  createOperationId: () => "00000000-0000-4000-8000-000000000001",
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: {},
  invalidateSessionReads: vi.fn(),
}));
import {
  clearScheduleAttempt,
  persistScheduleAttempt,
  prepareSchedule,
} from "./recurring-meal-retry";
const source = "00000000-0000-4000-8000-000000000002";
describe("durable schedule identity and payload", () => {
  it("recovers the unresolved original configuration after restart and isolates accounts", async () => {
    const records = new Map<string, string>();
    const store = {
      getItemAsync: vi.fn(async (key: string) => records.get(key) ?? null),
      setItemAsync: vi.fn(async (key: string, value: string) => {
        records.set(key, value);
      }),
      deleteItemAsync: vi.fn(async (key: string) => {
        records.delete(key);
      }),
    };
    const first = await prepareSchedule("user-a", source, store);
    const original = {
      ...first.payload,
      localTime: "10:00",
      timeZone: "Europe/Bratislava",
      weekdays: [1, 3, 5],
    };
    await persistScheduleAttempt("user-a", original, store);
    expect(await prepareSchedule("user-a", source, store)).toEqual({
      payload: original,
      attempted: true,
    });
    await prepareSchedule("user-b", source, store);
    expect(records.size).toBe(2);
    await clearScheduleAttempt("user-a", source, store);
    expect(records.size).toBe(1);
    expect([...records.keys()][0]).toContain("user-b");
  });
  it("cannot prepare an unsafe mutation when persistence is unavailable", async () => {
    const store = {
      getItemAsync: async () => null,
      setItemAsync: async () => {
        throw new Error("unavailable");
      },
      deleteItemAsync: async () => {},
    };
    await expect(prepareSchedule("user-a", source, store)).rejects.toThrow(
      "unavailable",
    );
  });
});

it("serializes concurrent preparation and refuses to overwrite an unresolved attempt", async () => {
  const records = new Map<string, string>();
  const store = {
    getItemAsync: async (key: string) => records.get(key) ?? null,
    setItemAsync: vi.fn(async (key: string, value: string) => {
      records.set(key, value);
    }),
    deleteItemAsync: async (key: string) => {
      records.delete(key);
    },
  };
  const [a, b] = await Promise.all([
    prepareSchedule("same-user", source, store),
    prepareSchedule("same-user", source, store),
  ]);
  expect(a.payload.id).toBe(b.payload.id);
  expect(store.setItemAsync).toHaveBeenCalledTimes(1);
  await persistScheduleAttempt("same-user", a.payload, store);
  await expect(
    persistScheduleAttempt(
      "same-user",
      { ...b.payload, localTime: "19:00" },
      store,
    ),
  ).rejects.toThrow("unresolved");
  await expect(
    persistScheduleAttempt(
      "same-user",
      { ...b.payload, id: "00000000-0000-4000-8000-000000000004" },
      store,
    ),
  ).rejects.toThrow("unresolved");
  expect(await prepareSchedule("same-user", source, store)).toEqual({
    payload: a.payload,
    attempted: true,
  });
});
