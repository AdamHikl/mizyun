import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  uuid: vi.fn(),
  appState: null as null | ((state: string) => void),
  cleanup: null as null | (() => void),
  focus: null as null | (() => () => void),
}));
const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  const same = (a: any[], b: any[]) =>
    a?.length === b?.length && a.every((v, i) => Object.is(v, b[i]));
  const memo = (f: () => any, deps: any[]) => {
    const i = hooks.index++;
    if (!hooks.slots[i] || !same(hooks.slots[i].deps, deps))
      hooks.slots[i] = { deps, value: f() };
    return hooks.slots[i].value;
  };
  return {
    ...actual,
    useRef: (current: unknown) => {
      const i = hooks.index++;
      return (hooks.slots[i] ??= { current });
    },
    useState: (initial: unknown) => {
      const i = hooks.index++;
      if (!(i in hooks.slots)) hooks.slots[i] = initial;
      return [
        hooks.slots[i],
        (next: any) => {
          hooks.slots[i] =
            typeof next === "function" ? next(hooks.slots[i]) : next;
        },
      ];
    },
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) =>
      snapshot(),
    useMemo: memo,
    useCallback: (f: any, deps: any[]) => memo(() => f, deps),
    useEffect: (callback: () => any, deps: any[]) => {
      const i = hooks.index++;
      const old = hooks.slots[i];
      if (!old || !same(old.deps, deps)) {
        hooks.slots[i] = { deps };
        hooks.effects.push(() => {
          old?.cleanup?.();
          hooks.slots[i].cleanup = callback();
        });
      }
    },
  };
});
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "ios" },
  StyleSheet: { create: (value: unknown) => value },
  TextInput: "TextInput",
  ScrollView: "ScrollView",
  Pressable: "Pressable",
  Alert: { alert: vi.fn() },
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, callback: (s: string) => void) => {
      mocks.appState = callback;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("expo-router", async () => {
  const React = await import("react");
  return {
    Stack: { Screen: "Screen" },
    router: { push: vi.fn() },
    useLocalSearchParams: () => ({
      activityId: "a1600000-0000-4000-8000-000000000001",
    }),
    useFocusEffect: (callback: () => () => void) => {
      mocks.focus = callback;
      React.useEffect(() => {
        mocks.cleanup = callback();
        return () => mocks.cleanup?.();
      }, [callback]);
    },
  };
});
vi.mock("expo-crypto", () => ({ randomUUID: mocks.uuid }));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: mocks.request, status: () => ({ kind: "ready" }) },
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("@/constants/theme", () => ({ MaxContentWidth: 720 }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/components/themed-text", () => ({ ThemedText: "Text" }));
vi.mock("../community-presentation", () => ({ CommunityIntro: "Intro" }));
import { CommunityCommentsScreen } from "./screen";
const audience =
  "I choose to share this text with everyone who can see this activity, including followers added later";
const author = {
  userId: "other",
  handle: "friend",
  displayName: "Friend",
  avatarSymbol: "F",
};
const item = {
  id: "comment",
  activityId: "activity",
  parentId: null,
  author,
  body: "Audience text",
  version: 1,
  mentions: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};
function render(): any {
  hooks.index = 0;
  const root = CommunityCommentsScreen();
  const tree = (root.type as any)(root.props);
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
function nodes(tree: any, type: string): any[] {
  if (!tree) return [];
  if (Array.isArray(tree)) return tree.flatMap((node) => nodes(node, type));
  return [
    ...(tree.type === type ? [tree] : []),
    ...nodes(tree.props?.children, type),
  ];
}
function control(tree: any, label: string) {
  return nodes(tree, "Pressable").find(
    (node) => node.props.accessibilityLabel === label,
  );
}
function input(tree: any) {
  return nodes(tree, "TextInput")[0];
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
async function start() {
  render();
  await flush();
  return render();
}
function write(text = "My unfinished encouragement") {
  input(render()).props.onChangeText(text);
  control(render(), audience).props.onPress();
  return render();
}
beforeEach(() => {
  vi.useFakeTimers();
  hooks.slots = [];
  hooks.effects = [];
  mocks.cleanup = null;
  mocks.appState = null;
  vi.clearAllMocks();
  let uuid = 0;
  mocks.uuid.mockImplementation(
    () => `e1600000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
  );
  mocks.request.mockImplementation(async (options) => ({
    ok: true,
    value: options.path.endsWith("candidates")
      ? { items: [author] }
      : {
          items: [item],
          nextCursor: null,
          enabled: true,
          canManage: false,
          allowMentions: false,
        },
  }));
});
afterEach(() => {
  mocks.cleanup?.();
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("comments composer authority expiry", () => {
  it("preserves own new writing and consent across idle rechecks, clearing it on background", async () => {
    await start();
    write();
    await vi.advanceTimersByTimeAsync(10_000);
    render();
    const tree = render();
    expect(input(tree).props.value).toBe("My unfinished encouragement");
    expect(control(tree, audience).props.accessibilityState.checked).toBe(true);
    mocks.appState!("background");
    render();
    mocks.appState!("active");
    await flush();
    expect(input(render()).props.value).toBe("");
  });
  it("retries an expired unconfirmed publication with the exact same id and operation, only after an explicit tap", async () => {
    await start();
    let finish!: (value: unknown) => void;
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    control(write(), "Publish comment").props.onPress();
    await flush();
    const writes = () =>
      mocks.request.mock.calls
        .map(([options]) => options)
        .filter((options) => options.method === "POST");
    const first = writes()[0].body;
    await vi.advanceTimersByTimeAsync(10_000);
    render();
    render();
    expect(writes()).toHaveLength(1);
    finish({ ok: true, value: { id: first.id, version: 1 } });
    await flush();
    expect(writes()).toHaveLength(1);
    control(render(), "Refresh").props.onPress();
    await flush();
    render();
    expect(input(render()).props.value).toBe("My unfinished encouragement");
    mocks.request.mockImplementationOnce(async () => ({
      ok: true,
      value: { id: first.id, version: 1 },
    }));
    control(render(), "Publish comment").props.onPress();
    await flush();
    expect(writes()).toHaveLength(2);
    expect(writes()[1].body).toEqual(first);
    expect(mocks.uuid).toHaveBeenCalledTimes(2);
  });
  it("uses a new publication identity when an expired edit becomes an ordinary draft", async () => {
    const own = { ...item, author: { ...author, userId: "actor" } };
    mocks.request.mockImplementation(async (options) => ({
      ok: true,
      value: options.path.endsWith("candidates")
        ? { items: [] }
        : {
            items: [own],
            nextCursor: null,
            enabled: true,
            canManage: false,
            allowMentions: false,
          },
    }));
    await start();
    control(render(), "Edit my comment").props.onPress();
    render();
    input(render()).props.onChangeText("My revised text");
    control(render(), audience).props.onPress();
    let finish!: (value: unknown) => void;
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    control(render(), "Save edited comment").props.onPress();
    await flush();
    const writes = () =>
      mocks.request.mock.calls
        .map(([options]) => options)
        .filter((options) => options.method === "POST");
    expect(writes()[0].body.id).toBe(item.id);
    await vi.advanceTimersByTimeAsync(10_000);
    render();
    render();
    finish({ ok: true, value: { id: item.id, version: 2 } });
    await flush();
    control(render(), "Refresh").props.onPress();
    await flush();
    render();
    control(render(), audience).props.onPress();
    control(render(), "Publish comment").props.onPress();
    await flush();
    expect(writes()).toHaveLength(2);
    expect(writes()[1].body.id).not.toBe(item.id);
    expect(writes()[1].body.expectedVersion).toBe(0);
  });
  it("retires reply and mention targets and requires consent again while retaining own text", async () => {
    await start();
    control(render(), "Reply to Friend").props.onPress();
    render();
    input(render()).props.onChangeText("My reply draft");
    control(render(), "Mention Friend").props.onPress();
    control(render(), audience).props.onPress();
    render();
    await vi.advanceTimersByTimeAsync(10_000);
    render();
    const tree = render();
    expect(input(tree).props.value).toBe("My reply draft");
    expect(control(tree, "Publish reply")).toBeUndefined();
    expect(
      control(tree, "Mention Friend").props.accessibilityState.checked,
    ).toBe(false);
    expect(control(tree, audience).props.accessibilityState.checked).toBe(
      false,
    );
  });
  it("explains a paused reply and resumes the kept text when Reply is tapped again", async () => {
    const texts = (tree: any) =>
      nodes(tree, "Text")
        .flatMap((node) => [node.props.children].flat())
        .filter((child) => typeof child === "string")
        .join(" ");
    await start();
    control(render(), "Reply to Friend").props.onPress();
    render();
    input(render()).props.onChangeText("My reply draft");
    render();
    await vi.advanceTimersByTimeAsync(10_000);
    render();
    let tree = render();
    expect(texts(tree)).toContain("Your reply was paused");
    control(tree, "Reply to Friend").props.onPress();
    render();
    tree = render();
    expect(input(tree).props.value).toBe("My reply draft");
    expect(texts(tree)).not.toContain("Your reply was paused");
  });
});

vi.mock("../ui", () => ({
  CommunityPage: "CommunityPage",
  CommunityIdentityLink: "CommunityIdentityLink",
  CommunityButton: "CommunityButton",
}));
