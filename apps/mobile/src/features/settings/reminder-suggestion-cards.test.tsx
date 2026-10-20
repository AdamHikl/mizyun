import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cells: [] as any[],
  index: 0,
  effects: [] as (() => unknown)[],
  suggestion: null as null | Record<string, number>,
  dismiss: vi.fn().mockResolvedValue(undefined),
  hookArgs: [] as any[],
  loadFirst: vi.fn(),
  saveFirst: vi.fn(),
  loadEvening: vi.fn(),
  applyEvening: vi.fn(),
  fetchDay: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const i = mocks.index++;
    if (!(i in mocks.cells)) mocks.cells[i] = initial;
    return [
      mocks.cells[i],
      (next: any) => {
        mocks.cells[i] =
          typeof next === "function" ? next(mocks.cells[i]) : next;
      },
    ];
  },
  useRef: (initial: any) => {
    const i = mocks.index++;
    if (!(i in mocks.cells)) mocks.cells[i] = { current: initial };
    return mocks.cells[i];
  },
  useEffect: (fn: () => unknown, deps: unknown[]) => {
    const i = mocks.index++;
    const prior = mocks.cells[i];
    if (
      !prior ||
      prior.some((value: unknown, j: number) => !Object.is(value, deps[j]))
    ) {
      mocks.cells[i] = deps;
      mocks.effects.push(fn);
    }
  },
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: (value: unknown) => value },
  Switch: "Switch",
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  ListGroup: "ListGroup",
  ListRow: "ListRow",
  SectionHeader: "SectionHeader",
}));
vi.mock("@/components/ui/native-date-time-picker", () => ({
  NativeTimePicker: "NativeTimePicker",
}));
vi.mock("@/components/ui/ios-time-picker-utils", () => ({
  formatTime12: (h: number, m: number) => `${h}:${m}`,
}));
vi.mock("@/constants/theme", () => ({ MinTouchTarget: 44, Spacing: {} }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("./use-reminder-time-suggestion", () => ({
  useReminderTimeSuggestion: (args: unknown) => {
    mocks.hookArgs.push(args);
    return { suggestion: mocks.suggestion, dismiss: mocks.dismiss };
  },
}));
vi.mock("@/features/log-meal/first-meal-reminders", () => ({
  DEFAULT_FIRST_MEAL_REMINDERS: {
    enabled: false,
    hour: 8,
    minute: 30,
    notificationIds: [],
  },
  loadFirstMealReminders: mocks.loadFirst,
}));
vi.mock("./first-meal-reminder-preferences", () => ({
  saveFirstMealReminderPreferences: mocks.saveFirst,
}));
vi.mock("@/features/log-meal/evening-catch-up-reminders", () => ({
  DEFAULT_EVENING_REMINDERS: {
    enabled: false,
    hour: 20,
    minute: 30,
    notificationIds: [],
  },
  loadEveningReminders: mocks.loadEvening,
  applyEveningReminders: mocks.applyEvening,
}));
vi.mock("@/features/log-meal/food-day-completion", () => ({
  getIsoLocalDate: () => "2026-10-15",
  isFoodDayCompleted: async () => false,
}));
vi.mock("@/features/log-meal/meal-lifecycle-data", () => ({
  fetchFoodDay: mocks.fetchDay,
}));

import { FirstMealRemindersCard } from "./first-meal-reminders-card";
import { EveningCatchUpRemindersCard } from "./evening-catch-up-reminders-card";
import { ReminderTimeSuggestionRow } from "./reminder-time-suggestion-row";

function find(node: any, predicate: (node: any) => boolean): any {
  if (Array.isArray(node))
    return node.map((child) => find(child, predicate)).find(Boolean) ?? null;
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  return (
    find(node.props?.children, predicate) ??
    find(node.props?.trailing, predicate)
  );
}
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
async function open(Card: (props: { userId: string }) => any) {
  mocks.index = 0;
  Card({ userId: "u1" });
  for (const effect of mocks.effects.splice(0)) effect();
  await settle();
  mocks.index = 0;
  return Card({ userId: "u1" });
}
const render = (Card: (props: { userId: string }) => any) => {
  mocks.index = 0;
  return Card({ userId: "u1" });
};
const row = (tree: any) =>
  find(tree, (node) => node.type === ReminderTimeSuggestionRow);

beforeEach(() => {
  mocks.cells = [];
  mocks.effects = [];
  mocks.hookArgs = [];
  mocks.suggestion = null;
  mocks.dismiss.mockClear();
  mocks.loadFirst.mockReset().mockResolvedValue({
    enabled: true,
    hour: 8,
    minute: 30,
    notificationIds: [],
  });
  mocks.saveFirst.mockReset().mockImplementation(async (_user, settings) => ({
    ok: true,
    settings,
  }));
  mocks.loadEvening.mockReset().mockResolvedValue({
    enabled: true,
    hour: 20,
    minute: 30,
    notificationIds: [],
  });
  mocks.applyEvening.mockReset().mockImplementation(async (_user, request) => ({
    ok: true,
    settings: { ...request, notificationIds: [] },
  }));
  mocks.fetchDay.mockReset().mockResolvedValue({ message: null, entries: [] });
});

describe("first-meal learned time suggestion", () => {
  const suggestion = { hour: 7, minute: 30, usualHour: 7, usualMinute: 45 };

  it("is hidden when no suggestion applies and compares against the saved time", async () => {
    const tree = await open(FirstMealRemindersCard);
    expect(row(tree)).toBeNull();
    expect(mocks.hookArgs.at(-1)).toMatchObject({
      userId: "u1",
      kind: "first-meal",
      enabled: true,
      saved: { enabled: true, hour: 8, minute: 30 },
    });
  });

  it("does not look for suggestions while the reminder is off", async () => {
    mocks.loadFirst.mockResolvedValue({
      enabled: false,
      hour: 8,
      minute: 30,
      notificationIds: [],
    });
    await open(FirstMealRemindersCard);
    expect(mocks.hookArgs.at(-1)).toMatchObject({ enabled: false });
  });

  it("shows the suggestion and Apply saves the new time through the normal path", async () => {
    mocks.suggestion = suggestion;
    const tree = await open(FirstMealRemindersCard);
    const shown = row(tree);
    expect(shown.props.kind).toBe("first-meal");
    expect(shown.props.suggestion).toEqual(suggestion);
    expect(mocks.saveFirst).not.toHaveBeenCalled();
    shown.props.onApply();
    await settle();
    expect(mocks.saveFirst).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ enabled: true, hour: 7, minute: 30 }),
    );
  });

  it("Dismiss persists without saving or rescheduling", async () => {
    mocks.suggestion = suggestion;
    const tree = await open(FirstMealRemindersCard);
    row(tree).props.onDismiss();
    expect(mocks.dismiss).toHaveBeenCalledTimes(1);
    expect(mocks.saveFirst).not.toHaveBeenCalled();
  });

  it("a failed Apply does not move the saved baseline", async () => {
    mocks.suggestion = suggestion;
    mocks.saveFirst.mockResolvedValue({ ok: false, reason: "unavailable" });
    const tree = await open(FirstMealRemindersCard);
    row(tree).props.onApply();
    await settle();
    expect(mocks.hookArgs.at(-1)).toBeDefined();
    const after = render(FirstMealRemindersCard);
    expect(mocks.hookArgs.at(-1).saved).toMatchObject({ hour: 8, minute: 30 });
    expect(row(after)).not.toBeNull();
  });
});

describe("evening learned time suggestion", () => {
  const suggestion = { hour: 19, minute: 30, usualHour: 18, usualMinute: 30 };

  it("Apply saves and Dismiss only persists", async () => {
    mocks.suggestion = suggestion;
    const tree = await open(EveningCatchUpRemindersCard);
    expect(mocks.hookArgs.at(-1)).toMatchObject({
      kind: "evening",
      saved: { enabled: true, hour: 20, minute: 30 },
    });
    row(tree).props.onDismiss();
    expect(mocks.dismiss).toHaveBeenCalledTimes(1);
    expect(mocks.applyEvening).not.toHaveBeenCalled();
    row(tree).props.onApply();
    await settle();
    expect(mocks.applyEvening).toHaveBeenCalledWith(
      "u1",
      { enabled: true, hour: 19, minute: 30 },
      { todayCompleted: false, hasMealAfter6Pm: false },
    );
  });

  it("saving after a dinner already logged keeps today's prompt suppressed", async () => {
    mocks.suggestion = suggestion;
    mocks.fetchDay.mockResolvedValue({
      message: null,
      entries: [{ consumedAt: new Date(2026, 9, 15, 18, 45).toISOString() }],
    });
    const tree = await open(EveningCatchUpRemindersCard);
    row(tree).props.onApply();
    await settle();
    expect(mocks.applyEvening.mock.calls[0]![2]).toEqual({
      todayCompleted: false,
      hasMealAfter6Pm: true,
    });
  });

  it("an unreadable day never blocks saving", async () => {
    mocks.suggestion = suggestion;
    mocks.fetchDay.mockRejectedValue(new Error("offline"));
    const tree = await open(EveningCatchUpRemindersCard);
    row(tree).props.onApply();
    await settle();
    expect(mocks.applyEvening.mock.calls[0]![2]).toMatchObject({
      hasMealAfter6Pm: false,
    });
  });
});

describe("suggestion row", () => {
  it("renders one line with Apply and Dismiss", () => {
    const tree = ReminderTimeSuggestionRow({
      kind: "first-meal",
      suggestion: { hour: 7, minute: 30, usualHour: 7, usualMinute: 45 },
      busy: false,
      onApply: vi.fn(),
      onDismiss: vi.fn(),
    });
    const text = find(tree, (n) => n.type === "ThemedText");
    expect(text.props.children).toBe(
      "You usually log your first meal around 07:45. Remind at 07:30?",
    );
    const labels = ["Apply", "Dismiss"].map((label) =>
      find(tree, (n) => n.type === "Button" && n.props.label === label),
    );
    expect(labels.every(Boolean)).toBe(true);
    expect(labels.map((b) => b.props.disabled)).toEqual([false, false]);
  });
});
