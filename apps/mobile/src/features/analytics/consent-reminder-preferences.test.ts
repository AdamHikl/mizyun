import { describe, expect, it, vi } from "vitest";
vi.mock("expo-secure-store", () => ({}));
import {
  ANALYTICS_REMINDER_INTERVAL_MS,
  analyticsReminderKey,
  clearAnalyticsReminder,
  loadAnalyticsReminder,
  reserveAnalyticsReminder,
  stopAnalyticsReminders,
  type AnalyticsReminderStore,
} from "./consent-reminder-preferences";

const now = Date.parse("2026-10-12T12:00:00Z");
function memoryStore() {
  const values = new Map<string, string>();
  const store: AnalyticsReminderStore = {
    getItemAsync: vi.fn(async (key) => values.get(key) ?? null),
    setItemAsync: vi.fn(async (key, value) => {
      values.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key) => {
      values.delete(key);
    }),
  };
  return { store, values };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("analytics reminder durability", () => {
  it.each(["reservation", "refusal"])(
    "does not restore an erased account after a delayed native %s write",
    async (operation) => {
      const { store, values } = memoryStore();
      const entered = deferred();
      const release = deferred();
      let active = true;
      vi.mocked(store.setItemAsync).mockImplementationOnce(
        async (key, value) => {
          entered.resolve();
          await release.promise;
          values.set(key, value);
        },
      );
      const writing =
        operation === "reservation"
          ? reserveAnalyticsReminder("account-a", store, now, () => active)
          : stopAnalyticsReminders("account-a", store);
      await entered.promise;
      active = false;
      const clearing = clearAnalyticsReminder("account-a", store);
      release.resolve();
      await Promise.all([writing, clearing]);
      expect(values.has(analyticsReminderKey("account-a"))).toBe(false);
      if (operation === "reservation") expect(await writing).toBe(false);
    },
  );

  it.each(["reservation", "refusal"])(
    "retires queued old-owner writes and preserves the current refusal after a delayed %s",
    async (operation) => {
      const { store, values } = memoryStore();
      const entered = deferred();
      const release = deferred();
      vi.mocked(store.setItemAsync).mockImplementationOnce(
        async (key, value) => {
          entered.resolve();
          await release.promise;
          values.set(key, value);
        },
      );
      const writing =
        operation === "reservation"
          ? reserveAnalyticsReminder("account-a", store, now)
          : stopAnalyticsReminders("account-a", store);
      await entered.promise;
      const oldReservation = reserveAnalyticsReminder("account-a", store, now);
      const oldRefusal = stopAnalyticsReminders("account-a", store);
      const clearing = clearAnalyticsReminder("account-a", store);
      const currentRefusal = stopAnalyticsReminders("account-a", store);
      expect(await reserveAnalyticsReminder("account-b", store, now)).toBe(
        true,
      );
      release.resolve();
      await Promise.all([writing, oldRefusal, clearing, currentRefusal]);
      expect(await oldReservation).toBe(false);
      expect((await loadAnalyticsReminder("account-a", store))?.neverAsk).toBe(
        true,
      );
      expect(
        await reserveAnalyticsReminder(
          "account-a",
          store,
          now + 10 * ANALYTICS_REMINDER_INTERVAL_MS,
        ),
      ).toBe(false);
      expect(store.setItemAsync).toHaveBeenCalledTimes(3);
      expect(
        (await loadAnalyticsReminder("account-b", store))?.nextPromptAt,
      ).toBe(now + ANALYTICS_REMINDER_INTERVAL_MS);
      await clearAnalyticsReminder("account-a", store);
      expect(await reserveAnalyticsReminder("account-a", store, now)).toBe(
        true,
      );
    },
  );

  it("serializes reservations so simultaneous checks cannot present twice", async () => {
    const { store } = memoryStore();
    expect(
      await Promise.all([
        reserveAnalyticsReminder("account-a", store, now),
        reserveAnalyticsReminder("account-a", store, now),
      ]),
    ).toEqual([true, false]);
    expect(store.setItemAsync).toHaveBeenCalledTimes(1);
  });

  it("preserves a later refusal after a cancelled native reservation", async () => {
    const { store, values } = memoryStore();
    const entered = deferred();
    const release = deferred();
    let active = true;
    vi.mocked(store.setItemAsync).mockImplementationOnce(async (key, value) => {
      entered.resolve();
      await release.promise;
      values.set(key, value);
    });
    const reservation = reserveAnalyticsReminder(
      "account-a",
      store,
      now,
      () => active,
    );
    await entered.promise;
    active = false;
    const refusal = stopAnalyticsReminders("account-a", store);
    release.resolve();
    expect(await reservation).toBe(false);
    await refusal;
    expect((await loadAnalyticsReminder("account-a", store))?.neverAsk).toBe(
      true,
    );
    expect(
      await reserveAnalyticsReminder(
        "account-a",
        store,
        now + 10 * ANALYTICS_REMINDER_INTERVAL_MS,
      ),
    ).toBe(false);
  });

  it("suppresses new operations after failed erasure until an erasure retry succeeds", async () => {
    const { store } = memoryStore();
    vi.mocked(store.deleteItemAsync).mockRejectedValueOnce(new Error("locked"));
    await expect(clearAnalyticsReminder("account-a", store)).rejects.toThrow(
      "locked",
    );
    expect(await loadAnalyticsReminder("account-a", store)).toBeNull();
    expect(await reserveAnalyticsReminder("account-a", store, now)).toBe(false);
    await expect(stopAnalyticsReminders("account-a", store)).rejects.toThrow(
      "Reminder erasure pending",
    );
    expect(store.setItemAsync).not.toHaveBeenCalled();
    await clearAnalyticsReminder("account-a", store);
    expect(await reserveAnalyticsReminder("account-a", store, now)).toBe(true);
  });

  it("cleans a retired native result that committed before rejecting", async () => {
    const { store, values } = memoryStore();
    const entered = deferred();
    const release = deferred();
    vi.mocked(store.setItemAsync).mockImplementationOnce(async (key, value) => {
      entered.resolve();
      await release.promise;
      values.set(key, value);
      throw new Error("lost response");
    });
    const writing = reserveAnalyticsReminder("account-a", store, now);
    await entered.promise;
    const clearing = clearAnalyticsReminder("account-a", store);
    release.resolve();
    expect(await writing).toBe(false);
    await clearing;
    expect(values.has(analyticsReminderKey("account-a"))).toBe(false);
    expect(await reserveAnalyticsReminder("account-a", store, now)).toBe(true);
  });

  it("survives restart/dismissal and becomes eligible at exactly fourteen days", async () => {
    const { store } = memoryStore();
    expect(await reserveAnalyticsReminder("account-a", store, now)).toBe(true);
    expect(
      (await loadAnalyticsReminder("account-a", store))?.nextPromptAt,
    ).toBe(now + ANALYTICS_REMINDER_INTERVAL_MS);
    expect(
      await reserveAnalyticsReminder(
        "account-a",
        { ...store },
        now + ANALYTICS_REMINDER_INTERVAL_MS - 1,
      ),
    ).toBe(false);
    expect(
      await reserveAnalyticsReminder(
        "account-a",
        { ...store },
        now + ANALYTICS_REMINDER_INTERVAL_MS,
      ),
    ).toBe(true);
  });

  it("persists Don't ask again independently for each account", async () => {
    const { store } = memoryStore();
    await stopAnalyticsReminders("account-a", store);
    expect(
      await reserveAnalyticsReminder(
        "account-a",
        { ...store },
        now + 10 * ANALYTICS_REMINDER_INTERVAL_MS,
      ),
    ).toBe(false);
    expect(await reserveAnalyticsReminder("account-b", store, now)).toBe(true);
  });

  it.each([
    "broken-json",
    '{"version":2,"nextPromptAt":0,"neverAsk":false}',
    '{"version":1,"nextPromptAt":-1,"neverAsk":false}',
    '{"version":1,"nextPromptAt":0}',
    '{"version":1,"nextPromptAt":"0","neverAsk":false}',
  ])(
    "suppresses corrupt/unknown preferences instead of resetting refusal: %s",
    async (value) => {
      const { store, values } = memoryStore();
      values.set(analyticsReminderKey("account-a"), value);
      expect(await reserveAnalyticsReminder("account-a", store, now)).toBe(
        false,
      );
      expect(store.setItemAsync).not.toHaveBeenCalled();
    },
  );

  it.each(["read", "write"])(
    "does not show a prompt when storage %s fails",
    async (failure) => {
      const { store } = memoryStore();
      if (failure === "read")
        vi.mocked(store.getItemAsync).mockRejectedValue(new Error("locked"));
      else vi.mocked(store.setItemAsync).mockRejectedValue(new Error("locked"));
      expect(await reserveAnalyticsReminder("account-a", store, now)).toBe(
        false,
      );
    },
  );

  it("does not reserve a reminder after sign-out during storage read", async () => {
    const { store } = memoryStore();
    let active = true;
    vi.mocked(store.getItemAsync).mockImplementationOnce(async () => {
      active = false;
      return null;
    });
    expect(
      await reserveAnalyticsReminder("account-a", store, now, () => active),
    ).toBe(false);
    expect(store.setItemAsync).not.toHaveBeenCalled();
  });

  it("does not present a reminder after account switch during storage write", async () => {
    const { store, values } = memoryStore();
    let active = true;
    vi.mocked(store.setItemAsync).mockImplementationOnce(async (key, value) => {
      values.set(key, value);
      active = false;
    });
    expect(
      await reserveAnalyticsReminder("account-a", store, now, () => active),
    ).toBe(false);
    expect(store.setItemAsync).toHaveBeenCalledWith(
      analyticsReminderKey("account-a"),
      expect.any(String),
    );
    expect(
      (await loadAnalyticsReminder("account-a", store))?.nextPromptAt,
    ).toBe(now + ANALYTICS_REMINDER_INTERVAL_MS);
    expect(await reserveAnalyticsReminder("account-a", store, now + 1)).toBe(
      false,
    );
  });

  it("propagates failed suppression and account-erasure writes", async () => {
    const { store } = memoryStore();
    vi.mocked(store.setItemAsync).mockRejectedValue(new Error("locked"));
    vi.mocked(store.deleteItemAsync).mockRejectedValue(new Error("locked"));
    await expect(stopAnalyticsReminders("account-a", store)).rejects.toThrow(
      "locked",
    );
    await expect(clearAnalyticsReminder("account-a", store)).rejects.toThrow(
      "locked",
    );
  });

  it("account erasure clears only the requested reminder", async () => {
    const { store } = memoryStore();
    await stopAnalyticsReminders("account-a", store);
    await stopAnalyticsReminders("account-b", store);
    await clearAnalyticsReminder("account-a", store);
    expect((await loadAnalyticsReminder("account-a", store))?.neverAsk).toBe(
      false,
    );
    expect((await loadAnalyticsReminder("account-b", store))?.neverAsk).toBe(
      true,
    );
  });
});
