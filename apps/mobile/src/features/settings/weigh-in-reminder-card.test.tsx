import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cells: [] as any[],
  index: 0,
  effects: [] as (() => unknown)[],
  load: vi.fn(),
  apply: vi.fn(),
  read: vi.fn(),
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
      prior.some((v: unknown, j: number) => !Object.is(v, deps[j]))
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
  View: "View",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Chip: "Chip",
  ListGroup: "ListGroup",
  ListRow: "ListRow",
  SectionHeader: "SectionHeader",
}));
vi.mock("@/components/ui/ios-time-picker", () => ({
  IosTimePicker: "IosTimePicker",
  formatTime12: (h: number, m: number) => `${h}:${String(m).padStart(2, "0")}`,
}));
vi.mock("@/constants/theme", () => ({ MinTouchTarget: 44, Spacing: {} }));
vi.mock("@/features/log-weight/log-weight-data", () => ({
  readLastBodyEntry: mocks.read,
  // The real date logic is covered in log-weight-data.test.ts.
  isWeightLoggedToday: (entry: { weightKg: number | null } | null) =>
    entry !== null && entry.weightKg !== null,
}));
vi.mock("@/features/log-weight/weigh-in-reminders", () => ({
  DEFAULT_WEIGH_IN_REMINDERS: {
    enabled: false,
    hour: 7,
    minute: 30,
    weekdays: [2, 5],
    notificationIds: [],
  },
  loadWeighInReminders: mocks.load,
  applyWeighInReminders: mocks.apply,
}));

import {
  describeWeighInDays,
  WeighInReminderCard,
} from "./weigh-in-reminder-card";

function findAll(node: any, predicate: (n: any) => boolean, out: any[] = []) {
  if (Array.isArray(node)) node.forEach((c) => findAll(c, predicate, out));
  else if (node && typeof node === "object") {
    if (predicate(node)) out.push(node);
    findAll(node.props?.children, predicate, out);
    findAll(node.props?.trailing, predicate, out);
  }
  return out;
}
const byLabel = (tree: any, label: string) =>
  findAll(tree, (n) => n.props?.accessibilityLabel === label)[0];
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const render = () => {
  mocks.index = 0;
  return WeighInReminderCard({ userId: "u1" });
};
async function open() {
  render();
  for (const effect of mocks.effects.splice(0)) effect();
  await settle();
  return render();
}

beforeEach(() => {
  mocks.cells = [];
  mocks.effects = [];
  mocks.load.mockReset().mockResolvedValue({
    enabled: false,
    hour: 7,
    minute: 30,
    weekdays: [2, 5],
    notificationIds: [],
  });
  mocks.apply.mockReset().mockImplementation(async (_u, request) => ({
    ok: true,
    settings: { ...request, notificationIds: [] },
  }));
  mocks.read.mockReset().mockResolvedValue({ ok: true, entry: null });
});

describe("weigh-in reminder card", () => {
  it("is off by default and shows no time or days until enabled", async () => {
    const tree = await open();
    expect(byLabel(tree, "Weigh-in reminder").props.value).toBe(false);
    expect(findAll(tree, (n) => n.type === "IosTimePicker")).toHaveLength(0);
    expect(findAll(tree, (n) => n.type === "Chip")).toHaveLength(0);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("suggests Monday and Thursday, lets the user change days, and saves only on Save", async () => {
    let tree = await open();
    byLabel(tree, "Weigh-in reminder").props.onValueChange(true);
    tree = render();
    const chips = findAll(tree, (n) => n.type === "Chip");
    expect(chips.map((c) => c.props.accessibilityLabel)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    expect(chips.map((c) => c.props.selected)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(mocks.apply).not.toHaveBeenCalled();
    chips[0]!.props.onPress(); // untoggle Monday
    chips[6]!.props.onPress(); // add Sunday
    tree = render();
    await byLabel(tree, "Save weigh-in reminder").props.onPress();
    await settle();
    expect(mocks.apply).toHaveBeenCalledWith(
      "u1",
      { enabled: true, hour: 7, minute: 30, weekdays: [5, 1] },
      { todayLogged: false },
    );
  });

  it("will not save an enabled reminder with no days", async () => {
    let tree = await open();
    byLabel(tree, "Weigh-in reminder").props.onValueChange(true);
    tree = render();
    for (const chip of findAll(tree, (n) => n.type === "Chip"))
      if (chip.props.selected) chip.props.onPress();
    tree = render();
    byLabel(tree, "Save weigh-in reminder").props.onPress();
    await settle();
    expect(mocks.apply).not.toHaveBeenCalled();
    const text = findAll(render(), (n) => n.type === "ThemedText").map(
      (n) => n.props.children,
    );
    expect(text).toContain("Choose at least one day for the reminder.");
  });

  it("does not schedule today's reminder when a weight is already logged today", async () => {
    mocks.read.mockResolvedValue({
      ok: true,
      entry: {
        measuredAt: new Date().toISOString(),
        weightKg: 80,
        waistCm: null,
        chestCm: null,
      },
    });
    let tree = await open();
    byLabel(tree, "Weigh-in reminder").props.onValueChange(true);
    tree = render();
    byLabel(tree, "Save weigh-in reminder").props.onPress();
    await settle();
    expect(mocks.apply.mock.calls[0]![2]).toEqual({ todayLogged: true });
  });

  it("turning it off saves a disabled preference", async () => {
    mocks.load.mockResolvedValue({
      enabled: true,
      hour: 7,
      minute: 30,
      weekdays: [2, 5],
      notificationIds: [],
    });
    let tree = await open();
    byLabel(tree, "Weigh-in reminder").props.onValueChange(false);
    tree = render();
    byLabel(tree, "Save weigh-in reminder").props.onPress();
    await settle();
    expect(mocks.apply.mock.calls[0]![1]).toMatchObject({ enabled: false });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("describes days compactly", () => {
    expect(describeWeighInDays([5, 2])).toBe("Mon, Thu");
    expect(describeWeighInDays([1, 2, 3, 4, 5, 6, 7])).toBe("every day");
  });
});
