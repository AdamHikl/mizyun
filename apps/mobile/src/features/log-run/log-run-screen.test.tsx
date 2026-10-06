import { beforeEach, describe, it, expect, vi } from "vitest";
import type { RunDraft } from "./run-draft";
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
  useLocalSearchParams: () => mocks.params,
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
vi.mock("@/features/running/client", () => ({ getRun: vi.fn() }));
vi.mock("./run-draft", () => ({
  runDraftStore: { load: mocks.load, save: mocks.persist, clear: mocks.clear },
  sendRunCommand: mocks.send,
  hasRunDraftContent: (draft: RunDraft) =>
    !!draft.pending ||
    draft.editingRunId !== null ||
    !!(
      draft.form.minutes ||
      draft.form.seconds ||
      draft.form.distance ||
      draft.form.effort ||
      draft.form.notes
    ),
}));
import { LogRunScreen } from "./log-run-screen";
function render() {
  hooks.index = 0;
  const tree = LogRunScreen();
  for (const effect of hooks.effects.splice(0)) effect();
  return tree;
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (!node) return null;
  if (Array.isArray(node))
    return node.map((n) => find(n, predicate)).find(Boolean);
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const input = (tree: any, label: string) =>
  find(
    tree,
    (n) => n.type === "TextInput" && n.props.accessibilityLabel === label,
  );
const action = (tree: any, label: string) =>
  find(
    tree,
    (n) => n.type === "Pressable" && n.props.accessibilityLabel === label,
  );
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const restored: RunDraft = {
  version: 1,
  form: {
    activityDate: "2026-10-01",
    recordingTimezone: "Europe/Bratislava",
    minutes: "90",
    seconds: "30",
    distance: "5",
    unit: "km",
    environment: "outdoor",
    effort: "",
    notes: "",
  },
  editingRunId: null,
  expectedRevision: null,
  pending: null,
};
beforeEach(() => {
  hooks.slots = [];
  hooks.effects = [];
  hooks.index = 0;
  mocks.owner = "user-a";
  mocks.token = 0;
  mocks.params = {};
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(null);
  mocks.persist.mockResolvedValue(true);
  mocks.clear.mockResolvedValue(true);
  mocks.send.mockResolvedValue({
    ok: false,
    message: "Offline. Draft is kept.",
  });
});
describe("direct run form", () => {
  it("opens the form directly and saves duration-only with more-than-hour minutes", async () => {
    render();
    await flush();
    let tree = render();
    expect(input(tree, "Minutes")).toBeTruthy();
    expect(input(tree, "Distance (km, optional)")).toBeTruthy();
    input(tree, "Minutes").props.onChangeText("90");
    tree = render();
    input(tree, "Seconds").props.onChangeText("30");
    tree = render();
    action(tree, "Save run").props.onPress();
    await flush();
    expect(mocks.send.mock.calls[0]?.[1].pending.body).toMatchObject({
      durationSeconds: 5430,
      distanceMeters: null,
      startedAt: null,
    });
  });
  it("converts entered distance when switching units", async () => {
    mocks.load.mockResolvedValue(restored);
    render();
    await flush();
    let tree = render();
    find(
      tree,
      (n) =>
        n.type === "Pressable" &&
        n.props.accessibilityLabel === "Distance unit mi",
    ).props.onPress();
    tree = render();
    expect(
      Number(input(tree, "Distance (mi, optional)").props.value),
    ).toBeCloseTo(3.10686, 5);
  });
  it("retains encrypted draft and leaves on ordinary Back without confirmation", async () => {
    mocks.load.mockResolvedValue(restored);
    render();
    await flush();
    render();
    const event = {
      preventDefault: vi.fn(),
      data: { action: { type: "GO_BACK" } },
    };
    mocks.beforeRemove?.(event);
    await flush();
    expect(mocks.persist).toHaveBeenCalledWith("user-a", restored);
    expect(mocks.dispatch).toHaveBeenCalledWith(event.data.action);
    expect(mocks.alert).not.toHaveBeenCalled();
  });
  it("shows Keep editing / Discard only if Back persistence fails", async () => {
    mocks.load.mockResolvedValue(restored);
    render();
    await flush();
    render();
    mocks.persist.mockResolvedValue(false);
    mocks.beforeRemove?.({
      preventDefault: vi.fn(),
      data: { action: { type: "GO_BACK" } },
    });
    await flush();
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.alert.mock.calls[0]?.[2].map((a: any) => a.text)).toEqual([
      "Keep editing",
      "Discard unsaved changes",
    ]);
  });
  it("locks pending request fields after an uncertain response and exposes retry", async () => {
    const pending = {
      ...restored,
      pending: {
        kind: "create",
        body: {
          clientOperationId: "11111111-1111-4111-8111-111111111111",
          activityDate: "2026-10-01",
          recordingTimezone: "Europe/Bratislava",
          startedAt: null,
          durationSeconds: 5430,
          distanceMeters: 5000,
          environment: "outdoor",
          perceivedExertion: null,
          name: "Run",
          notes: null,
        },
      },
    };
    mocks.load.mockResolvedValue(pending);
    render();
    await flush();
    const tree = render();
    expect(input(tree, "Minutes").props.editable).toBe(false);
    expect(action(tree, "Retry pending run")).toBeTruthy();
    action(tree, "Retry pending run").props.onPress();
    await flush();
    expect(mocks.send.mock.calls[0]?.[1]).toEqual(pending);
  });
  it("does not restore the previous account's form after an account switch", async () => {
    mocks.load.mockImplementation(async (user: string) =>
      user === "user-a" ? restored : null,
    );
    render();
    await flush();
    expect(input(render(), "Minutes").props.value).toBe("90");
    mocks.owner = "user-b";
    render();
    await flush();
    expect(input(render(), "Minutes").props.value).toBe("");
    expect(mocks.load).toHaveBeenLastCalledWith("user-b");
  });
});

describe("running account-owned request state", () => {
  it.each(["refresh", "switch"])(
    "retires busy state on %s and ignores late old success",
    async (transition) => {
      let completeOld!: (result: any) => void;
      let completeNew!: (result: any) => void;
      let stored: RunDraft = restored;
      mocks.load.mockImplementation(async () => stored);
      mocks.persist.mockImplementation(
        async (_owner: string, value: RunDraft) => {
          stored = JSON.parse(JSON.stringify(value));
          return true;
        },
      );
      mocks.send
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              completeOld = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              completeNew = resolve;
            }),
        );
      render();
      await flush();
      let tree = render();
      action(tree, "Save run").props.onPress();
      await flush();
      render();
      await flush();
      if (transition === "switch") mocks.owner = "user-b";
      else mocks.token++;
      render();
      await flush();
      tree = render();
      const retry = action(tree, "Retry pending run");
      expect(retry.props.disabled).toBe(false);
      retry.props.onPress();
      await flush();
      completeOld({ ok: true, value: { id: "late" } });
      await flush();
      tree = render();
      expect(action(tree, "Saving…").props.disabled).toBe(true);
      expect(mocks.replace).not.toHaveBeenCalled();
      completeNew({ ok: false, message: "Still pending" });
      await flush();
      expect(action(render(), "Retry pending run").props.disabled).toBe(false);
    },
  );
  it("keeps exact source distance when switching units twice before a notes-only save", async () => {
    const source = {
      ...restored,
      form: {
        ...restored.form,
        distance: "0.10001",
        distanceCanonicalMeters: 100.01,
        distanceCanonicalInput: "0.10001",
        distanceCanonicalUnit: "km" as const,
      },
    };
    mocks.load.mockResolvedValue(source);
    render();
    await flush();
    let tree = render();
    find(
      tree,
      (n) =>
        n.type === "Pressable" &&
        n.props.accessibilityLabel === "Distance unit mi",
    ).props.onPress();
    tree = render();
    find(
      tree,
      (n) =>
        n.type === "Pressable" &&
        n.props.accessibilityLabel === "Distance unit km",
    ).props.onPress();
    tree = render();
    action(tree, "Save run").props.onPress();
    await flush();
    expect(mocks.send.mock.calls[0]?.[1].pending.body.distanceMeters).toBe(
      100.01,
    );
  });
});

describe("strict pending draft hydration", () => {
  it("does not replace an unreadable pending operation with a fresh draft", async () => {
    mocks.load.mockRejectedValue(new Error("secure storage locked"));
    render();
    await flush();
    const tree = render();
    expect(action(tree, "Save run")).toBeFalsy();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(
      find(tree, (node) => node.props?.accessibilityRole === "alert"),
    ).toBeTruthy();
  });
});

describe("empty completed-run entry", () => {
  it("leaves an untouched empty form on Back without a saved blocking slot", async () => {
    render();
    await flush();
    render();
    const event = {
      preventDefault: vi.fn(),
      data: { action: { type: "GO_BACK" } },
    };
    mocks.beforeRemove?.(event);
    await flush();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});

describe("run draft ownership before effects settle", () => {
  it("never copies account A's immutable command to account B during the first B render", async () => {
    const pending = {
      ...restored,
      pending: {
        kind: "create" as const,
        body: {
          clientOperationId: "11111111-1111-4111-8111-111111111111",
          activityDate: "2026-10-01",
          recordingTimezone: "Europe/Bratislava",
          startedAt: null,
          durationSeconds: 5430,
          distanceMeters: 5000,
          environment: "outdoor" as const,
          perceivedExertion: null,
          name: "Run",
          notes: "private account A",
        },
      },
    };
    mocks.load.mockImplementation(async (user: string) =>
      user === "user-a" ? pending : null,
    );
    render();
    await flush();
    let tree = render();
    const oldRetry = action(tree, "Retry pending run");
    await flush();
    mocks.owner = "user-b";
    tree = render();
    expect(input(tree, "Minutes")).toBeFalsy();
    expect(action(tree, "Retry pending run")).toBeFalsy();
    expect(
      mocks.persist.mock.calls.some(
        ([owner, draft]) =>
          owner === "user-b" &&
          draft.pending?.body?.notes === "private account A",
      ),
    ).toBe(false);
    oldRetry.props.onPress();
    mocks.beforeRemove?.({
      preventDefault: vi.fn(),
      data: { action: { type: "GO_BACK" } },
    });
    await flush();
    render();
    await flush();
    expect(
      mocks.persist.mock.calls.some(
        ([owner, draft]) =>
          owner === "user-b" &&
          draft.pending?.body?.notes === "private account A",
      ),
    ).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalledWith("user-a");
  });
  it("restores the same account's pending operation after token refresh without copying it into another owner", async () => {
    const pending = {
      ...restored,
      pending: {
        kind: "cancel" as const,
        operationId: "11111111-1111-4111-8111-111111111111",
      },
    };
    mocks.load.mockResolvedValue(pending);
    render();
    await flush();
    render();
    mocks.token++;
    const refreshing = render();
    expect(action(refreshing, "Retry pending run")).toBeFalsy();
    await flush();
    const tree = render();
    expect(action(tree, "Retry pending run")).toBeTruthy();
    expect(
      mocks.persist.mock.calls.every(([owner]) => owner === "user-a"),
    ).toBe(true);
    expect(mocks.clear).not.toHaveBeenCalled();
  });
});

describe("queued run draft confirmations", () => {
  it("does not clear account A or navigate when its discard dialog is confirmed after switching to B", async () => {
    mocks.load.mockImplementation(async (user: string) =>
      user === "user-a" ? restored : null,
    );
    render();
    await flush();
    action(render(), "Discard draft").props.onPress();
    const confirmation = mocks.alert.mock.calls[0]?.[2][1].onPress;
    mocks.owner = "user-b";
    render();
    confirmation();
    await flush();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.back).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not dispatch an old Back action when its failed-persistence dialog is confirmed after account switch", async () => {
    mocks.load.mockImplementation(async (user: string) =>
      user === "user-a" ? restored : null,
    );
    render();
    await flush();
    render();
    mocks.persist.mockResolvedValue(false);
    mocks.beforeRemove?.({
      preventDefault: vi.fn(),
      data: { action: { type: "GO_BACK" } },
    });
    await flush();
    const confirmation = mocks.alert.mock.calls[0]?.[2][1].onPress;
    mocks.owner = "user-b";
    render();
    confirmation();
    await flush();
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.back).not.toHaveBeenCalled();
  });
});
