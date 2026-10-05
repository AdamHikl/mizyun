import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cells: [] as any[],
  index: 0,
  save: vi.fn().mockResolvedValue(true),
  dismiss: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const i = mocks.index++;
    if (!(i in mocks.cells)) mocks.cells[i] = initial;
    return [
      mocks.cells[i],
      (next: any) => {
        mocks.cells[i] = next;
      },
    ];
  },
  useEffect: () => {},
  useCallback: (fn: unknown) => fn,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Pressable: "Pressable",
  Switch: "Switch",
  View: "View",
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("@/composition/app-variant", () => ({
  getAppVariant: () => "production",
}));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/features/workouts/workout-preferences", async (original) => ({
  ...(await original<typeof import("../workouts/workout-preferences")>()),
  saveWorkoutPreferences: mocks.save,
}));
vi.mock("@/features/workouts/workout-notification", () => ({
  dismissActiveWorkoutNotification: mocks.dismiss,
}));
import { Platform } from "react-native";
import { WorkoutSettingsCard } from "./workout-settings-card";

function find(node: any, label: string): any {
  if (Array.isArray(node))
    return node.map((child) => find(child, label)).find(Boolean) ?? null;
  if (!node || typeof node !== "object") return null;
  return node.props?.accessibilityLabel === label
    ? node
    : find(node.props?.children, label);
}
function render() {
  mocks.index = 0;
  return WorkoutSettingsCard({ userId: "synthetic-workout-owner" });
}
beforeEach(() => {
  mocks.cells = [];
  mocks.save.mockReset().mockResolvedValue(true);
  mocks.dismiss.mockClear();
  Platform.OS = "ios";
});
it("presents the Production iOS Live Activity control and persists opt-out", async () => {
  const control = find(render(), "Toggle workout Live Activity");
  expect(control.props.value).toBe(true);
  await control.props.onValueChange(false);
  expect(mocks.save).toHaveBeenCalledWith(
    expect.objectContaining({ liveNotificationEnabled: false }),
    "synthetic-workout-owner",
  );
  expect(mocks.dismiss).toHaveBeenCalledTimes(1);
  expect(find(render(), "Toggle workout Live Activity").props.value).toBe(
    false,
  );
});
it("keeps Android notification control and opt-out available", async () => {
  Platform.OS = "android";
  const control = find(render(), "Toggle live workout notification");
  expect(find(render(), "Toggle workout Live Activity")).toBeNull();
  await control.props.onValueChange(false);
  expect(mocks.save).toHaveBeenCalledWith(
    expect.objectContaining({ liveNotificationEnabled: false }),
    "synthetic-workout-owner",
  );
});

it("does not clear status on enabling or report a failed opt-out as saved", async () => {
  const control = find(render(), "Toggle workout Live Activity");
  await control.props.onValueChange(true);
  expect(mocks.dismiss).not.toHaveBeenCalled();
  mocks.save.mockResolvedValueOnce(false);
  await control.props.onValueChange(false);
  expect(mocks.dismiss).not.toHaveBeenCalled();
  expect(find(render(), "Toggle workout Live Activity").props.value).toBe(true);
});
