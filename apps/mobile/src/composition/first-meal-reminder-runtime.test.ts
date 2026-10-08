import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  list: vi.fn(),
  cancel: vi.fn(),
  activate: vi.fn(),
  suspend: vi.fn(),
  reconcile: vi.fn(),
  repeat: vi.fn(),
  day: vi.fn(),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: mocks.read,
  setItemAsync: mocks.write,
}));
vi.mock("expo-notifications", () => ({
  getAllScheduledNotificationsAsync: mocks.list,
  cancelScheduledNotificationAsync: mocks.cancel,
}));
vi.mock("@/features/log-meal/first-meal-reminders", () => ({
  activateFirstMealReminders: mocks.activate,
  suspendFirstMealReminders: mocks.suspend,
  reconcileFirstMealReminders: mocks.reconcile,
}));
vi.mock("@/features/dashboard/public-data", () => ({
  loadQuickMealRepeat: mocks.repeat,
}));
vi.mock("@/features/log-meal/meal-lifecycle-data", () => ({
  fetchFoodDay: mocks.day,
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(null);
  mocks.write.mockResolvedValue(undefined);
  mocks.list.mockResolvedValue([]);
  mocks.suspend.mockResolvedValue(undefined);
  mocks.reconcile.mockResolvedValue(undefined);
  mocks.repeat.mockResolvedValue(null);
  mocks.day.mockResolvedValue({ message: null, summary: { entryCount: 0 } });
});
it("suppresses today after activation using the confirmed copy journal on cold start", async () => {
  mocks.repeat.mockImplementation(async (owner) => {
    expect(owner).toBe("a");
    expect(mocks.activate).toHaveBeenCalledWith("a");
    return { completed: true };
  });
  const { firstMealReminderLifecycle } =
    await import("./first-meal-reminder-runtime");
  await firstMealReminderLifecycle.setOwner("a");
  expect(mocks.reconcile).toHaveBeenCalledWith("a", { todayLogged: true });
  expect(mocks.day).not.toHaveBeenCalled();
});
it("does not treat an unconfirmed operation as a saved meal", async () => {
  mocks.repeat.mockResolvedValue({ completed: false });
  const { firstMealReminderLifecycle } =
    await import("./first-meal-reminder-runtime");
  await firstMealReminderLifecycle.setOwner("a");
  expect(mocks.reconcile).toHaveBeenCalledWith("a", { todayLogged: false });
});
it("keeps scheduling closed when the local proof cannot be read", async () => {
  mocks.repeat.mockRejectedValue(new Error("Keychain locked"));
  const { firstMealReminderLifecycle } =
    await import("./first-meal-reminder-runtime");
  await expect(firstMealReminderLifecycle.setOwner("a")).rejects.toThrow(
    "Keychain locked",
  );
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
