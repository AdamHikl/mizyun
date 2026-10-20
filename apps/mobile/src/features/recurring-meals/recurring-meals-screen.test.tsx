import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  owner: "user-a",
  source: "meal-source" as string | undefined,
  load: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  stop: vi.fn(),
  skip: vi.fn(),
  entry: vi.fn(),
  alerts: vi.fn(),
  operation: vi.fn(),
  clear: vi.fn(),
  persist: vi.fn(),
  reset: vi.fn(),
  canSkip: vi.fn(),
}));
const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
  cleanups: new Map<number, () => void>(),
  focus: null as (() => void) | null,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (current: unknown) => (hooks.slots[hooks.index++] ??= { current }),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (next: any) => {
        hooks.slots[index] =
          typeof next === "function" ? next(hooks.slots[index]) : next;
      },
    ];
  },
  useCallback: (callback: unknown, dependencies: any[]) => {
    const index = hooks.index++;
    const previous = hooks.slots[index];
    if (
      !previous ||
      previous.dependencies.some(
        (value: any, i: number) => !Object.is(value, dependencies[i]),
      )
    )
      hooks.slots[index] = { callback, dependencies };
    return hooks.slots[index].callback;
  },
  useMemo: (callback: () => unknown) => callback(),
  useEffect: (callback: () => void, dependencies: any[]) => {
    const index = hooks.index++;
    const previous = hooks.slots[index];
    if (
      !previous ||
      previous.length !== dependencies.length ||
      previous.some(
        (value: any, i: number) => !Object.is(value, dependencies[i]),
      )
    ) {
      hooks.slots[index] = dependencies;
      hooks.effects.push(() => {
        hooks.cleanups.get(index)?.();
        const cleanup = callback() as unknown;
        if (typeof cleanup === "function")
          hooks.cleanups.set(index, cleanup as () => void);
        else hooks.cleanups.delete(index);
      });
    }
  },
}));

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
  Alert: { alert: mocks.alerts },
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: "StackScreen" },
  useLocalSearchParams: () => ({ sourceEntryId: mocks.source }),
  useFocusEffect: (callback: () => void) => {
    hooks.focus = callback;
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("@/components/ui/native-date-time-picker", () => ({
  NativeDatePicker: "NativeDatePicker",
  NativeTimePicker: "NativeTimePicker",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/constants/theme", () => ({ MaxContentWidth: 600, Spacing: {} }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: mocks.owner }, accessToken: `token-${mocks.owner}` },
  }),
}));
vi.mock("@/features/log-meal/public-data", () => ({
  fetchFoodEntry: mocks.entry,
}));
vi.mock("./recurring-meal-retry", () => ({
  prepareSchedule: mocks.operation,
  persistScheduleAttempt: mocks.persist,
  clearScheduleAttempt: mocks.clear,
  resetRejectedSchedule: mocks.reset,
}));
vi.mock("./recurring-meal-data", async (original) => ({
  ...(await original<typeof import("./recurring-meal-data")>()),
  loadSchedules: mocks.load,
  createSchedule: mocks.create,
  updateSchedule: mocks.update,
  skipSchedule: mocks.skip,
  stopSchedule: mocks.stop,
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: {},
  invalidateSessionReads: vi.fn(),
}));
vi.mock("./recurring-meal-schedule", async (original) => ({
  ...(await original<typeof import("./recurring-meal-schedule")>()),
  canSkipToday: (...args: unknown[]) => mocks.canSkip(...args),
}));
import { RecurringMealsScreen } from "./recurring-meals-screen";
function render(): any {
  hooks.index = 0;
  const tree = RecurringMealsScreen();
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
function find(node: any, label: string): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node))
    return node.map((child) => find(child, label)).find(Boolean);
  return node.props?.accessibilityLabel === label
    ? node
    : find(node.props?.children, label);
}
function timePicker(node: any): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) return node.map(timePicker).find(Boolean) ?? null;
  return node.type === "NativeTimePicker"
    ? node
    : timePicker(node.props?.children);
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
const schedule = {
  id: "schedule-1",
  name: "Oats",
  localTime: "10:00",
  timeZone: "Europe/Bratislava",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  enabled: true,
};
beforeEach(() => {
  hooks.slots = [];
  hooks.effects = [];
  hooks.cleanups = new Map();
  hooks.index = 0;
  hooks.focus = null;
  Object.values(mocks).forEach((value) => {
    if (typeof value === "function") value.mockReset();
  });
  mocks.owner = "user-a";
  mocks.source = "meal-source";
  mocks.entry.mockResolvedValue({ ok: true, entry: { name: "Oats" } });
  mocks.operation.mockResolvedValue({
    payload: {
      id: "00000000-0000-4000-8000-000000000001",
      sourceEntryId: "00000000-0000-4000-8000-000000000002",
      localTime: "08:00",
      timeZone: "Europe/Bratislava",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    },
    attempted: false,
  });
  mocks.persist.mockResolvedValue(undefined);
  mocks.reset.mockImplementation(async (_user: string, payload: any) => ({
    payload: { ...payload, id: "00000000-0000-4000-8000-000000000003" },
    attempted: false,
  }));
  mocks.clear.mockResolvedValue(undefined);
  mocks.load.mockResolvedValue({ ok: true, recurringMeals: [] });
  mocks.create.mockResolvedValue({ ok: true });
  mocks.update.mockResolvedValue({ ok: true });
  mocks.skip.mockResolvedValue({ ok: true });
  mocks.stop.mockResolvedValue({ ok: true });
  mocks.canSkip.mockReturnValue(true);
});
describe("recurring meals screen boundaries", () => {
  it("requires explicit Save, supports presets, and retries an ambiguous save with its original identity", async () => {
    render();
    hooks.focus!();
    await settle();
    expect(mocks.create).not.toHaveBeenCalled();
    let tree = render();
    find(tree, "Evening · 19:00").props.onPress();
    tree = render();
    find(tree, "Sunday").props.onPress();
    mocks.create.mockResolvedValueOnce({
      ok: false,
      message: "Connection lost",
    });
    tree = render();
    find(tree, "Save schedule").props.onPress();
    await settle();
    tree = render();
    expect(timePicker(tree).props.disabled).toBe(true);
    expect(find(tree, "Sunday").props.disabled).toBe(true);
    timePicker(tree).props.onChange(12, 0);
    tree = render();
    find(tree, "Retry save").props.onPress();
    await settle();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    const [first, second] = mocks.create.mock.calls;
    expect(first[0]).toMatchObject({
      id: "00000000-0000-4000-8000-000000000001",
      sourceEntryId: "00000000-0000-4000-8000-000000000002",
      localTime: "19:00",
      weekdays: [1, 2, 3, 4, 5, 6],
    });
    expect(second[0]).toEqual(first[0]);
    expect(first[1].expectedUserId).toBe("user-a");
    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });
  it("discards delayed private management/source reads after an account switch", async () => {
    let resolve!: (value: unknown) => void;
    mocks.load.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let sourceResolve!: (value: unknown) => void;
    mocks.entry.mockReturnValueOnce(
      new Promise((done) => {
        sourceResolve = done;
      }),
    );
    render();
    hooks.focus!();
    mocks.owner = "user-b";
    mocks.source = undefined;
    render();
    resolve({ ok: true, recurringMeals: [schedule] });
    sourceResolve({ ok: true, entry: { name: "Private account A meal" } });
    await settle();
    const tree = render();
    expect(find(tree, "Edit Oats")).toBeFalsy();
    expect(find(tree, "Save schedule")).toBeFalsy();
  });
  it("offers pause/resume, edit days/time, and confirms skip and stop", async () => {
    mocks.source = undefined;
    mocks.load.mockResolvedValue({ ok: true, recurringMeals: [schedule] });
    render();
    hooks.focus!();
    await settle();
    let tree = render();
    find(tree, "Pause Oats").props.onPress();
    await settle();
    expect(mocks.update).toHaveBeenCalledWith(
      "schedule-1",
      { enabled: false },
      expect.objectContaining({ expectedUserId: "user-a" }),
    );
    tree = render();
    find(tree, "Skip today for Oats").props.onPress();
    expect(mocks.skip).not.toHaveBeenCalled();
    mocks.alerts.mock.calls.at(-1)![2][1].onPress();
    await settle();
    expect(mocks.skip).toHaveBeenCalledTimes(1);
    tree = render();
    find(tree, "Edit Oats").props.onPress();
    tree = render();
    timePicker(tree).props.onChange(11, 0);
    tree = render();
    find(tree, "Save schedule").props.onPress();
    await settle();
    expect(mocks.update).toHaveBeenLastCalledWith(
      "schedule-1",
      expect.objectContaining({ localTime: "11:00" }),
      expect.anything(),
    );
    tree = render();
    find(tree, "Stop Oats").props.onPress();
    expect(mocks.stop).not.toHaveBeenCalled();
    const confirm = mocks.alerts.mock.calls.at(-1)![2][1].onPress;
    mocks.owner = "user-b";
    render();
    confirm();
    await settle();
    expect(mocks.stop).not.toHaveBeenCalled();
  });
  it("ignores an old write response when another account is current", async () => {
    let resolve!: (value: unknown) => void;
    mocks.create.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render();
    hooks.focus!();
    await settle();
    const tree = render();
    find(tree, "Save schedule").props.onPress();
    mocks.owner = "user-b";
    mocks.source = undefined;
    render();
    resolve({ ok: true });
    await settle();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(find(render(), "Save schedule")).toBeFalsy();
  });
});

it("restores an unresolved schedule after screen restart with frozen original settings", async () => {
  const recovered = {
    payload: {
      id: "00000000-0000-4000-8000-000000000001",
      sourceEntryId: "00000000-0000-4000-8000-000000000002",
      localTime: "10:00",
      timeZone: "America/New_York",
      weekdays: [1, 3, 5],
    },
    attempted: true,
  };
  mocks.operation.mockResolvedValue(recovered);
  render();
  hooks.focus!();
  await settle();
  const tree = render();
  expect(timePicker(tree).props).toMatchObject({
    label: "Time",
    hour: 10,
    minute: 0,
  });
  expect(find(tree, "Schedule time zone").props.value).toBe("America/New_York");
  expect(find(tree, "Monday").props.disabled).toBe(true);
  find(tree, "Retry save").props.onPress();
  await settle();
  expect(mocks.create).toHaveBeenCalledWith(
    recovered.payload,
    expect.objectContaining({ expectedUserId: "user-a" }),
  );
});

it("hides the previous account's schedules on the account-switch render before effects settle", async () => {
  mocks.source = undefined;
  mocks.load.mockResolvedValue({ ok: true, recurringMeals: [schedule] });
  render();
  hooks.focus!();
  await settle();
  expect(find(render(), "Edit Oats")).toBeTruthy();
  mocks.owner = "user-b";
  expect(find(render(), "Edit Oats")).toBeFalsy();
});

it("resumes a paused schedule without creating a replacement", async () => {
  mocks.source = undefined;
  mocks.load.mockResolvedValue({
    ok: true,
    recurringMeals: [{ ...schedule, enabled: false }],
  });
  render();
  hooks.focus!();
  await settle();
  find(render(), "Resume Oats").props.onPress();
  await settle();
  expect(mocks.update).toHaveBeenCalledWith(
    "schedule-1",
    { enabled: true },
    expect.anything(),
  );
  expect(mocks.create).not.toHaveBeenCalled();
});

it.each([422, 409])(
  "recovers a definitively rejected create (%s) so the next corrected submission can proceed",
  async () => {
    mocks.create.mockResolvedValueOnce({
      ok: false,
      definitiveRejected: true,
      message: "Rejected",
    });
    render();
    hooks.focus!();
    await settle();
    find(render(), "Save schedule").props.onPress();
    await settle();
    let tree = render();
    expect(timePicker(tree).props.disabled).toBe(false);
    expect(mocks.reset).toHaveBeenCalledTimes(1);
    timePicker(tree).props.onChange(11, 0);
    tree = render();
    find(tree, "Save schedule").props.onPress();
    await settle();
    expect(mocks.create.mock.calls[1][0]).toMatchObject({
      id: "00000000-0000-4000-8000-000000000003",
      localTime: "11:00",
    });
  },
);

it("can finish cleanup after a confirmed save without sending a second create", async () => {
  mocks.clear.mockRejectedValueOnce(new Error("storage unavailable"));
  render();
  hooks.focus!();
  await settle();
  find(render(), "Save schedule").props.onPress();
  await settle();
  find(render(), "Finish saved schedule").props.onPress();
  await settle();
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.clear).toHaveBeenCalledTimes(2);
  expect(find(render(), "Retry save")).toBeFalsy();
});

it("does not let a delayed source A replace the source B editor for the same account", async () => {
  let resolve!: (value: unknown) => void;
  mocks.entry.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render();
  mocks.source = "00000000-0000-4000-8000-000000000004";
  mocks.entry.mockResolvedValueOnce({ ok: true, entry: { name: "Source B" } });
  mocks.operation.mockResolvedValueOnce({
    payload: {
      id: "00000000-0000-4000-8000-000000000003",
      sourceEntryId: mocks.source,
      localTime: "19:00",
      timeZone: "UTC",
      weekdays: [1],
    },
    attempted: false,
  });
  render();
  await settle();
  resolve({ ok: true, entry: { name: "Source A" } });
  await settle();
  find(render(), "Save schedule").props.onPress();
  await settle();
  expect(mocks.create.mock.calls[0][0]).toMatchObject({
    sourceEntryId: "00000000-0000-4000-8000-000000000004",
    localTime: "19:00",
  });
});

it("does not close a new source editor when an older source save resolves for the same account", async () => {
  let resolve!: (value: unknown) => void;
  mocks.create.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render();
  hooks.focus!();
  await settle();
  find(render(), "Save schedule").props.onPress();
  await settle();
  mocks.source = "00000000-0000-4000-8000-000000000004";
  mocks.operation.mockResolvedValueOnce({
    payload: {
      id: "00000000-0000-4000-8000-000000000003",
      sourceEntryId: mocks.source,
      localTime: "19:00",
      timeZone: "UTC",
      weekdays: [1],
    },
    attempted: false,
  });
  render();
  await settle();
  resolve({ ok: true });
  await settle();
  expect(timePicker(render()).props).toMatchObject({ hour: 19, minute: 0 });
  expect(mocks.clear).not.toHaveBeenCalled();
});

const visibleText = (node: any): string =>
  [node.props.children]
    .flat()
    .map((child: any) =>
      typeof child === "string" ? child : visibleText(child),
    )
    .join("");

it("shows short visible labels with the meal name kept in accessibility labels and hints", async () => {
  mocks.source = undefined;
  mocks.load.mockResolvedValue({ ok: true, recurringMeals: [schedule] });
  render();
  hooks.focus!();
  await settle();
  const tree = render();
  const edit = find(tree, "Edit Oats");
  expect(visibleText(edit)).toBe("Edit");
  expect(visibleText(find(tree, "Pause Oats"))).toBe("Pause");
  const skip = find(tree, "Skip today for Oats");
  expect(visibleText(skip)).toBe("Skip today");
  expect(skip.props.accessibilityHint).toMatch(/removes it if already logged/);
  const stop = find(tree, "Stop Oats");
  expect(visibleText(stop)).toBe("Stop");
  expect(stop.props.accessibilityHint).toMatch(
    /Previously logged meals remain/,
  );
  expect(visibleText(find(tree, "Refresh recurring meals"))).toBe(
    "Refresh recurring meals",
  );
});

it("hides Skip today when today is not a scheduled day or the schedule is paused, and shows next occurrence", async () => {
  mocks.source = undefined;
  mocks.canSkip.mockReturnValue(false);
  mocks.load.mockResolvedValue({ ok: true, recurringMeals: [schedule] });
  render();
  hooks.focus!();
  await settle();
  const tree = render();
  expect(find(tree, "Skip today for Oats")).toBeFalsy();
  expect(find(tree, "Edit Oats")).toBeTruthy();
  expect(JSON.stringify(tree)).toMatch(/Next: (Today|Tomorrow) 10:00/);
});

it("speaks full weekday names for weekday toggles", async () => {
  render();
  hooks.focus!();
  await settle();
  const tree = render();
  const sunday = find(tree, "Sunday");
  expect(sunday.props.accessibilityRole).toBe("checkbox");
  expect(visibleText(sunday)).toBe("Sun");
});
