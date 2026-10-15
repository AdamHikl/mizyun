import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecurringMealSuggestionProposal } from "@mizyun/contracts";

const state = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  dismiss: vi.fn(),
  refresh: vi.fn(),
  retry: vi.fn(),
  undo: vi.fn(),
  chooseTimeZone: vi.fn(),
  push: vi.fn(),
  hook: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.slots)) state.slots[index] = initial;
    return [
      state.slots[index],
      (next: unknown) => {
        state.slots[index] =
          typeof next === "function" ? next(state.slots[index]) : next;
      },
    ];
  },
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("expo-router", () => ({ router: { push: mocks.push } }));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    background: "#000",
    backgroundElement: "#222",
    text: "#fff",
    border: "#666",
  }),
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    profile: { userId: "user-a", timezone: "Europe/Bratislava" },
  }),
}));
vi.mock("./recurring-meal-suggestion-data", () => ({
  useRecurringMealSuggestion: mocks.hook,
}));

import {
  describeWeekdays,
  RecurringMealSuggestionCard,
  RecurringMealSuggestionCardView,
  type RecurringMealSuggestionPresentation,
} from "./recurring-meal-suggestion-card";

const candidate = {
  candidateId: "mrs1-00000001",
  name: "Oats with banana",
  localTime: "10:15",
  timeZone: "Europe/Bratislava",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  startLocalDate: "2026-10-14",
  caloriesKcal: 300,
  proteinG: null,
  carbohydrateG: 42,
  fatG: 0,
  grams: null,
} as RecurringMealSuggestionProposal;
let model: RecurringMealSuggestionPresentation;
function render() {
  state.index = 0;
  return RecurringMealSuggestionCardView({ model });
}
function find(node: any, label: string): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node))
    return node.map((child) => find(child, label)).find(Boolean) ?? null;
  return node.props?.accessibilityLabel === label
    ? node
    : find(node.props?.children, label);
}
function text(node: any): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" ? text(node.props?.children) : "";
}
function press(tree: any, label: string) {
  const control = find(tree, label);
  expect(control).toBeTruthy();
  if (!control.props.disabled) control.props.onPress();
  return control;
}
beforeEach(() => {
  state.slots = [];
  state.index = 0;
  Object.values(mocks).forEach((mock) => mock.mockReset());
  model = {
    candidate,
    status: "ready",
    result: null,
    error: null,
    accept: mocks.accept,
    dismiss: mocks.dismiss,
    refresh: mocks.refresh,
    retry: mocks.retry,
    undo: mocks.undo,
    chooseTimeZone: mocks.chooseTimeZone,
  };
  mocks.hook.mockReturnValue(model);
});

describe("recurring meal suggestion presentation", () => {
  it("offers timezone choice before one-tap logging when device and profile differ", () => {
    model = {
      ...model,
      candidate: null,
      status: "timezone-choice",
      timezoneChoice: {
        device: "America/New_York",
        profile: "Europe/Bratislava",
      },
    };
    const tree = render();
    expect(text(tree)).toContain("differs from your profile timezone");
    expect(text(tree)).toContain("check your meal pattern again");
    expect(find(tree, "Change")).toBeNull();
    press(tree, "Use profile timezone: Europe/Bratislava");
    expect(mocks.chooseTimeZone).toHaveBeenCalledWith("Europe/Bratislava");
    press(tree, "Use device timezone: America/New_York");
    expect(mocks.chooseTimeZone).toHaveBeenCalledWith("America/New_York");
    expect(mocks.accept).not.toHaveBeenCalled();
  });
  it("shows the chosen zone prominently and changes timezone through fresh detection", () => {
    model.timezoneChoice = {
      device: "America/New_York",
      profile: "Europe/Bratislava",
    };
    expect(text(render())).toContain(
      "Timezone: Europe/Bratislava (your chosen timezone)",
    );
    press(render(), "Change");
    press(render(), "Use device timezone: America/New_York");
    expect(mocks.chooseTimeZone).toHaveBeenCalledWith("America/New_York");
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("states the three-day evidence and authorizes actual default time without routing health data", () => {
    const tree = render();
    expect(text(tree)).toContain("for 3 days in a row");
    expect(text(tree)).toContain(
      "every day at 10:15, starting tomorrow (2026-10-14)",
    );
    const control = press(
      tree,
      "Auto-log Oats with banana every day at 10:15 starting 2026-10-14 in Europe/Bratislava",
    );
    expect(control.props.style[0].minHeight).toBe(44);
    expect(mocks.accept).toHaveBeenCalledWith();
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("states the two-week weekday evidence and accepts the proposed days by default", () => {
    model.candidate = {
      ...candidate,
      name: "Oats",
      localTime: "07:45",
      reasonCode: "weekly_pattern",
      // Friday 2026-10-16: tomorrow is Saturday, so Monday is the first proposed day.
      startLocalDate: "2026-10-17",
      weekdays: [1, 2, 3, 4, 5],
    };
    const tree = render();
    expect(text(tree)).toContain(
      "You’ve had “Oats” on Mon–Fri for two weeks. Log it automatically on those days at 07:45, starting 2026-10-19?",
    );
    expect(text(tree)).not.toContain("3 days in a row");
    expect(text(tree)).not.toContain("every day");
    expect(
      find(
        tree,
        "Auto-log Oats every day at 07:45 starting 2026-10-17 in Europe/Bratislava",
      ),
    ).toBeNull();
    const control = press(
      tree,
      "Auto-log Oats on Monday to Friday at 07:45 starting 2026-10-19 in Europe/Bratislava",
    );
    expect(control.props.style[0].minHeight).toBe(44);
    expect(mocks.accept).toHaveBeenCalledWith();
    press(render(), "Change");
    expect(
      find(render(), "Auto-log on Mon").props.accessibilityState.selected,
    ).toBe(true);
    expect(
      find(render(), "Auto-log on Sun").props.accessibilityState.selected,
    ).toBe(false);
  });
  it("summarizes weekday sets compactly", () => {
    expect(describeWeekdays([1, 2, 3, 4, 5])).toBe("Mon–Fri");
    expect(describeWeekdays([1, 2, 3, 4, 5], true)).toBe("Monday to Friday");
    expect(describeWeekdays([1, 3, 5], true)).toBe("Monday, Wednesday, Friday");
    expect(describeWeekdays([5, 1, 3])).toBe("Mon, Wed, Fri");
    expect(describeWeekdays([0, 6])).toBe("Sat, Sun");
    expect(describeWeekdays([0, 1, 2, 5, 6])).toBe("Mon, Tue, Fri–Sun");
  });
  it("customizes proposal defaults through the same accept operation and previews the first selected date", () => {
    press(render(), "Change");
    let tree = render();
    expect(find(tree, "Automatic meal time, 24-hour HH:MM").props.value).toBe(
      "10:15",
    );
    find(tree, "Automatic meal time, 24-hour HH:MM").props.onChangeText(
      "11:30",
    );
    ["Sun", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((day) => {
      press(render(), `Auto-log on ${day}`);
    });
    tree = render();
    expect(text(tree)).toContain("Starts 2026-10-19, Mon at 11:30");
    press(
      tree,
      "Auto-log Oats with banana Mon at 11:30 starting 2026-10-19 in Europe/Bratislava",
    );
    expect(mocks.accept).toHaveBeenCalledWith({
      localTime: "11:30",
      weekdays: [1],
    });
  });
  it("shows missing nutrition as unknown and preserves actual zero", () => {
    press(render(), "Change");
    const tree = render();
    expect(text(tree)).toContain("Serving size not recorded");
    expect(text(tree)).toContain("Protein: not recorded");
    expect(text(tree)).toContain("Fat: 0 g");
    expect(text(tree)).toContain("Timezone: Europe/Bratislava");
  });
  it("prevents Save for invalid time or no selected days", () => {
    press(render(), "Change");
    find(render(), "Automatic meal time, 24-hour HH:MM").props.onChangeText(
      "25:30",
    );
    const tree = render();
    const control = press(
      tree,
      "Auto-log Oats with banana every day at 25:30 starting 2026-10-14 in Europe/Bratislava",
    );
    expect(control.props.disabled).toBe(true);
    expect(mocks.accept).not.toHaveBeenCalled();
  });
  it("distinguishes temporary and permanent dismissal", () => {
    press(render(), "Not now");
    expect(mocks.dismiss).toHaveBeenCalledWith(false);
    press(render(), "Change");
    press(render(), "Don't suggest this meal");
    expect(mocks.dismiss).toHaveBeenCalledWith(true);
  });
  it("exposes only recovery Retry while the result is unknown", () => {
    model.status = "unknown";
    const tree = render();
    expect(find(tree, "Change")).toBeNull();
    expect(find(tree, "Not now")).toBeNull();
    press(tree, "Retry");
    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(mocks.accept).not.toHaveBeenCalled();
  });
  it("disables every mutation while pending", () => {
    model.status = "pending";
    const tree = render();
    expect(find(tree, "Change").props.accessibilityState.disabled).toBe(true);
    press(tree, "Not now");
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });
  it("offers Undo only for newly created schedules, with Manage for both results", () => {
    model.result = {
      created: false,
      startLocalDate: "2026-10-14",
      recurringMeal: { enabled: true },
    } as any;
    model.status = "already-scheduled";
    let tree = render();
    expect(text(tree)).toContain("Already scheduled");
    expect(find(tree, "Undo")).toBeNull();
    press(tree, "Manage");
    expect(mocks.push).toHaveBeenCalledWith("/recurring-meals");
    model.result = { ...model.result!, created: true };
    model.status = "success";
    tree = render();
    expect(text(tree)).toContain("Automatic logging enabled from 2026-10-14");
    press(tree, "Undo");
    expect(mocks.undo).toHaveBeenCalledOnce();
    model.result = {
      ...model.result!,
      recurringMeal: { ...model.result!.recurringMeal, enabled: false },
    };
    tree = render();
    expect(text(tree)).toContain("This schedule is inactive");
    expect(text(tree)).not.toContain("Automatic logging enabled");
    expect(find(tree, "Undo")).toBeNull();
  });
  it("refreshes stale evidence without offering acceptance", () => {
    model.status = "stale";
    const tree = render();
    expect(find(tree, "Change")).toBeNull();
    press(tree, "Refresh suggestion");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("does not render on logout or while a host is recovering another meal", () => {
    expect(RecurringMealSuggestionCard({ userId: null })).toBeNull();
    expect(
      RecurringMealSuggestionCard({ userId: "user-a", hidden: true }),
    ).toBeNull();
    expect(mocks.hook).toHaveBeenLastCalledWith("user-a", {
      visible: false,
      profileTimeZone: "Europe/Bratislava",
    });
  });
  it("does not retain another account's expanded editor or candidate", () => {
    const first = RecurringMealSuggestionCard({ userId: "user-a" })!;
    mocks.hook.mockReturnValue({ ...model, candidate: null, status: "idle" });
    const next = RecurringMealSuggestionCard({ userId: "user-b" })!;
    expect(next.key).not.toBe(first.key);
    expect(mocks.hook).toHaveBeenLastCalledWith("user-b", {
      visible: true,
      profileTimeZone: null,
    });
    expect(next.props.model.candidate).toBeNull();
    state.index = 0;
    expect(RecurringMealSuggestionCardView(next.props)).toBeNull();
  });
  it("keeps recovery read failures visible with same-operation Retry even without a candidate", () => {
    model = {
      ...model,
      candidate: null,
      status: "error",
      error:
        "Could not read setup recovery. Try again when device storage is available.",
    };
    const tree = render();
    expect(text(tree)).toContain("Could not read setup recovery");
    expect(find(tree, "Change")).toBeNull();
    press(tree, "Retry");
    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(mocks.accept).not.toHaveBeenCalled();
    model.status = "pending";
    expect(find(render(), "Retry").props.disabled).toBe(true);
  });
});
