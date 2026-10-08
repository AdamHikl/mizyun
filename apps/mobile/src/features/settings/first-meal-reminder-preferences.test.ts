import { expect, it, vi } from "vitest";
vi.mock("../log-meal/first-meal-reminders", () => ({
  applyFirstMealReminders: vi.fn(),
}));
vi.mock("../log-meal/meal-lifecycle-data", () => ({
  fetchFoodDay: vi.fn(),
  isoLocalDate: (now: Date) =>
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
}));
import { saveFirstMealReminderPreferences } from "./first-meal-reminder-preferences";
import type { FirstMealReminderSettings } from "../log-meal/first-meal-reminders";
const settings: FirstMealReminderSettings = {
  enabled: true,
  hour: 9,
  minute: 0,
  notificationIds: [],
};
function setup() {
  return {
    readDay: vi.fn().mockResolvedValue({
      message: null,
      summary: { entryCount: 1 },
      entries: [],
    }),
    apply: vi.fn().mockResolvedValue({ ok: true, settings }),
    now: () => new Date(2026, 9, 8, 7),
  };
}
it("suppresses today's reminder when enabling or changing settings after a meal", async () => {
  const ports = setup();
  await saveFirstMealReminderPreferences("a", settings, ports);
  expect(ports.readDay).toHaveBeenCalledWith("2026-10-08");
  expect(ports.apply).toHaveBeenCalledWith("a", settings, {
    todayLogged: true,
    now: ports.now,
  });
});
it.each(["failed", "missing", "throws"])(
  "does not schedule or request permissions with %s meal read",
  async (kind) => {
    const ports = setup();
    if (kind === "throws")
      ports.readDay.mockRejectedValue(new Error("offline"));
    else
      ports.readDay.mockResolvedValue({
        message: kind === "failed" ? "Offline" : null,
        summary: null,
        entries: [],
      });
    expect(
      await saveFirstMealReminderPreferences("a", settings, ports),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(ports.apply).not.toHaveBeenCalled();
  },
);
it("allows turning reminders off without a network read", async () => {
  const ports = setup();
  await saveFirstMealReminderPreferences(
    "a",
    { ...settings, enabled: false },
    ports,
  );
  expect(ports.readDay).not.toHaveBeenCalled();
  expect(ports.apply).toHaveBeenCalled();
});
it("does not use yesterday's suppression after midnight during the read", async () => {
  const ports = setup();
  let count = 0;
  ports.now = () => new Date(2026, 9, count++ === 0 ? 8 : 9, 0);
  expect(await saveFirstMealReminderPreferences("a", settings, ports)).toEqual({
    ok: false,
    reason: "unavailable",
  });
  expect(ports.apply).not.toHaveBeenCalled();
});
it("rejects an action captured before an A to B to A account change", async () => {
  const base = setup();
  let generation = 1;
  const ports = {
    ...base,
    capture: () => {
      const captured = generation;
      return () => generation === captured;
    },
  };
  ports.readDay.mockImplementation(async () => {
    generation = 3;
    return { message: null, summary: { entryCount: 0 }, entries: [] };
  });
  expect(await saveFirstMealReminderPreferences("a", settings, ports)).toEqual({
    ok: false,
    reason: "unavailable",
  });
  expect(ports.apply).not.toHaveBeenCalled();
});
it("maps locked-storage scheduling rejection to a retryable settings error", async () => {
  const ports = setup();
  ports.apply.mockRejectedValue(new Error("Keychain locked"));
  expect(await saveFirstMealReminderPreferences("a", settings, ports)).toEqual({
    ok: false,
    reason: "unavailable",
  });
});
it("rejects a same-date timezone change while reading today's summary", async () => {
  const ports = setup();
  const before = ports.now();
  const after = ports.now();
  after.getTimezoneOffset = () => before.getTimezoneOffset() + 60;
  let calls = 0;
  ports.now = () => (calls++ === 0 ? before : after);
  expect(await saveFirstMealReminderPreferences("a", settings, ports)).toEqual({
    ok: false,
    reason: "unavailable",
  });
  expect(ports.apply).not.toHaveBeenCalled();
});
