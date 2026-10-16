import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  owner: "user-a",
  token: 0,
  load: vi.fn(),
  persist: vi.fn(),
  clear: vi.fn(),
  send: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  beforeRemove: null as null | ((event: any) => void),
  dispatch: vi.fn(),
  alert: vi.fn(),
  params: {} as { runId?: string },
  get: vi.fn(),
}));
const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (current: unknown) => (hooks.slots[hooks.index++] ??= { current }),
  useState: (initial: any) => {
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
  useEffect: (callback: () => void, dependencies: any[]) => {
    const index = hooks.index++;
    const previous = hooks.slots[index];
    if (
      !previous ||
      previous.some((v: any, i: number) => !Object.is(v, dependencies[i]))
    ) {
      hooks.slots[index] = dependencies;
      hooks.effects.push(callback);
    }
  },
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
  Alert: { alert: mocks.alert },
}));
vi.mock("expo-router", () => ({
  router: { back: mocks.back, replace: mocks.replace, push: vi.fn() },
  Stack: { Screen: "StackScreen" },
  useLocalSearchParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useNavigation: () => ({
    addListener: (_event: string, callback: any) => {
      mocks.beforeRemove = callback;
      return () => {};
    },
    dispatch: mocks.dispatch,
  }),
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/constants/theme", () => ({
  MaxContentWidth: 600,
  Spacing: { four: 16, three: 12 },
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ text: "black", border: "gray" }),
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: {
      user: { id: mocks.owner },
      accessToken: `token-${mocks.owner}-${mocks.token}`,
    },
    profile: { unitSystem: "metric", timezone: "Europe/Bratislava" },
  }),
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: {
    status: () => ({ configured: false, reason: "test" }),
    request: vi.fn(),
  },
  invalidateSessionReads: vi.fn(),
}));
vi.mock("./running-data", () => ({ getRun: details.get }));
vi.mock("./run-draft", () => ({
  runDraftStore: { load: mocks.load, save: mocks.persist, clear: mocks.clear },
  sendRunCommand: mocks.send,
  hasRunDraftContent: () => true,
}));
const details = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/features/log-run", () => ({
  runDraftStore: { load: mocks.load, save: mocks.persist, clear: mocks.clear },
  sendRunCommand: mocks.send,
  formFromRun: () => ({
    activityDate: "2026-10-01",
    recordingTimezone: "UTC",
    minutes: "25",
    seconds: "0",
    distance: "",
    unit: "km",
    environment: "unspecified",
    effort: "",
    notes: "",
  }),
}));
import { RunDetailScreen } from "./run-detail-screen";
function render() {
  hooks.index = 0;
  const tree = RunDetailScreen();
  for (const effect of hooks.effects.splice(0)) effect();
  return tree;
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (!node) return null;
  if (Array.isArray(node))
    return node.map((n) => find(n, predicate)).find(Boolean);
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const action = (tree: any, label: string) =>
  find(
    tree,
    (n) =>
      n.type === "Pressable" && n.props.children?.props?.children === label,
  );
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const run = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Run",
  userId: "user-a",
  notes: null,
  summary: {
    revision: 1,
    activityDate: "2026-10-01",
    recordingTimezone: "UTC",
    timePrecision: "day",
    startedAt: null,
    durationSeconds: 1500,
    distanceMeters: null,
    environment: "unspecified",
    perceivedExertion: null,
    durationBasis: "elapsed",
    origin: { kind: "manual" },
  },
};
beforeEach(() => {
  hooks.slots = [];
  hooks.effects = [];
  hooks.index = 0;
  mocks.owner = "user-a";
  mocks.token = 0;
  vi.clearAllMocks();
  details.get.mockImplementation(async () => ({
    ok: true,
    value: { ...run, userId: mocks.owner },
  }));
  mocks.load.mockResolvedValue(null);
  mocks.send.mockResolvedValue({ ok: false, message: "Pending removal" });
});
describe("run detail", () => {
  it("shows explicit missing distance and no invented start time", async () => {
    render();
    await flush();
    const tree = render();
    expect(
      find(tree, (n) => n.props?.children === "Distance not recorded"),
    ).toBeTruthy();
    expect(
      find(
        tree,
        (n) => n.props?.children === "Date only · No start time recorded",
      ),
    ).toBeTruthy();
  });
  it("resets deletion busy state on account switch and retires late success", async () => {
    let complete!: (value: any) => void;
    mocks.send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    render();
    await flush();
    let tree = render();
    action(tree, "Delete run").props.onPress();
    mocks.alert.mock.calls[0]?.[2][1].onPress();
    await flush();
    expect(action(render(), "Deleting…").props.disabled).toBe(true);
    mocks.owner = "user-b";
    render();
    await flush();
    tree = render();
    expect(action(tree, "Delete run").props.disabled).toBe(false);
    complete({ ok: true, value: true });
    await flush();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("keeps an existing unrelated draft instead of replacing it with a delete", async () => {
    mocks.load.mockResolvedValue({ editingRunId: null, pending: null });
    render();
    await flush();
    action(render(), "Delete run").props.onPress();
    mocks.alert.mock.calls[0]?.[2][1].onPress();
    await flush();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("run detail ownership before effects settle", () => {
  it("hides the previous account's record and rejects its queued actions immediately", async () => {
    render();
    await flush();
    const original = render();
    const oldDelete = action(original, "Delete run");
    mocks.owner = "user-b";
    const next = render();
    expect(action(next, "Delete run")).toBeFalsy();
    expect(
      find(next, (node) => node.props?.children === "Distance not recorded"),
    ).toBeFalsy();
    oldDelete.props.onPress();
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.persist.mock.calls.some(([owner]) => owner === "user-b")).toBe(
      false,
    );
  });
  it("rejects a mismatched owned record returned by a stale or incorrect read", async () => {
    details.get.mockResolvedValue({
      ok: true,
      value: { ...run, userId: "other-account" },
    });
    render();
    await flush();
    const tree = render();
    expect(action(tree, "Delete run")).toBeFalsy();
    expect(action(tree, "Edit run")).toBeFalsy();
  });
});
