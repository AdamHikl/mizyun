import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  picker: vi.fn(),
  save: vi.fn(),
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
  Image: "Image",
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
    useFocusEffect: (callback: () => () => void) => {
      mocks.focus = callback;
      React.useEffect(() => {
        mocks.cleanup = callback();
        return () => mocks.cleanup?.();
      }, [callback]);
    },
  };
});
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: mocks.picker }));
vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: {
    manipulate: () => ({
      resize: vi.fn(),
      renderAsync: async () => ({
        saveAsync: mocks.save,
      }),
    }),
  },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "e1600000-0000-4000-8000-000000000001",
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: mocks.request },
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    text: "black",
    textSecondary: "grey",
    border: "grey",
    background: "white",
  }),
}));
vi.mock("@/features/community", () => ({
  ReportModal: "ReportModal",
  scopeCommunityClient: (client: unknown) => client,
}));
import { CommunityMediaScreen } from "./screen";
const item = {
  id: "a1600000-0000-4000-8000-000000000001",
  authorHandle: "owner",
  altText: "Approved room photo",
  state: "approved",
  width: 200,
  height: 100,
  isOwner: false,
  createdAt: "2026-10-01T00:00:00Z",
};
function render(): any {
  hooks.index = 0;
  const root = CommunityMediaScreen();
  const tree = (root.type as any)(root.props);
  hooks.effects.splice(0).forEach((f) => f());
  return tree;
}
function nodes(tree: any, type: string): any[] {
  if (!tree) return [];
  if (Array.isArray(tree)) return tree.flatMap((n) => nodes(n, type));
  return [
    ...(tree.type === type ? [tree] : []),
    ...nodes(tree.props?.children, type),
  ];
}
function button(tree: any, label: string) {
  return nodes(tree, "Pressable").find((node) =>
    JSON.stringify(node.props.children).includes(label),
  );
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
beforeEach(() => {
  vi.useFakeTimers();
  hooks.slots = [];
  hooks.effects = [];
  mocks.cleanup = null;
  mocks.appState = null;
  vi.clearAllMocks();
  mocks.request.mockImplementation(async (options) =>
    options.path.endsWith("/content")
      ? { ok: true, value: { mimeType: "image/jpeg", base64: "AQIDBA==" } }
      : { ok: true, value: { items: [item], nextCursor: null } },
  );
  mocks.save.mockResolvedValue({
    uri: "file:selected.jpg",
    base64: "AQIDBA==",
  });
  mocks.picker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:input.jpg", width: 200, height: 100 }],
  });
});
afterEach(() => {
  mocks.cleanup?.();
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("protected media screen lifecycle", () => {
  it("expires delivered metadata and bytes without waiting for another interaction", async () => {
    render();
    await flush();
    expect(nodes(render(), "Image")).toHaveLength(1);
    vi.advanceTimersByTime(10_000);
    const tree = render();
    expect(nodes(tree, "Image")).toHaveLength(0);
    expect(JSON.stringify(nodes(tree, "Text"))).not.toContain(item.altText);
  });
  it("hides prior data immediately during stalled refresh and rejects a late authorization result", async () => {
    render();
    await flush();
    vi.advanceTimersByTime(9_000);
    let release!: (value: any) => void;
    mocks.request.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    button(render(), "Refresh").props.onPress();
    expect(nodes(render(), "Image")).toHaveLength(0);
    expect(JSON.stringify(nodes(render(), "Text"))).not.toContain(item.altText);
    vi.advanceTimersByTime(10_000);
    release({ ok: true, value: { items: [item], nextCursor: null } });
    await flush();
    expect(nodes(render(), "Image")).toHaveLength(0);
    expect(JSON.stringify(nodes(render(), "Text"))).not.toContain(item.altText);
  });
  it("rejects bytes that arrive after the metadata authorization deadline", async () => {
    let release!: (value: any) => void;
    mocks.request.mockImplementation((options) =>
      options.path.endsWith("/content")
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve({
            ok: true,
            value: { items: [item], nextCursor: null },
          }),
    );
    render();
    await flush();
    expect(JSON.stringify(nodes(render(), "Text"))).toContain(item.altText);
    vi.advanceTimersByTime(10_000);
    release({
      ok: true,
      value: { mimeType: "image/jpeg", base64: "AQIDBA==" },
    });
    await flush();
    expect(nodes(render(), "Image")).toHaveLength(0);
    expect(JSON.stringify(nodes(render(), "Text"))).not.toContain(item.altText);
  });
  it("keeps revoked data hidden after a failed fresh read", async () => {
    render();
    await flush();
    mocks.request.mockResolvedValueOnce({ ok: false });
    button(render(), "Refresh").props.onPress();
    await flush();
    expect(nodes(render(), "Image")).toHaveLength(0);
    expect(JSON.stringify(nodes(render(), "Text"))).not.toContain(item.altText);
  });
  it("clears metadata too when a fresh byte authorization fails after the list", async () => {
    mocks.request.mockImplementation(async (options) =>
      options.path.endsWith("/content")
        ? { ok: false }
        : { ok: true, value: { items: [item], nextCursor: null } },
    );
    render();
    await flush();
    expect(nodes(render(), "Image")).toHaveLength(0);
    expect(JSON.stringify(nodes(render(), "Text"))).not.toContain(item.altText);
  });
  it("contains a rejected refresh without retaining previously delivered bytes", async () => {
    render();
    await flush();
    mocks.request.mockRejectedValueOnce(new Error("Network unavailable"));
    button(render(), "Refresh").props.onPress();
    await flush();
    expect(nodes(render(), "Image")).toHaveLength(0);
    expect(JSON.stringify(nodes(render(), "Text"))).not.toContain(item.altText);
  });
  it("drops late authorized image responses after leaving the route", async () => {
    let release!: (value: any) => void;
    mocks.request.mockImplementation((options) =>
      options.path.endsWith("/content")
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve({
            ok: true,
            value: { items: [item], nextCursor: null },
          }),
    );
    render();
    await flush();
    expect(release).toBeTypeOf("function");
    mocks.cleanup!();
    release({
      ok: true,
      value: { mimeType: "image/jpeg", base64: "AQIDBA==" },
    });
    await flush();
    expect(nodes(render(), "Image")).toHaveLength(0);
  });
  it("clears already delivered thumbnails on inactive transition", async () => {
    render();
    await flush();
    expect(nodes(render(), "Image")).toHaveLength(1);
    mocks.appState!("inactive");
    expect(nodes(render(), "Image")).toHaveLength(0);
  });
  it("returns from the native picker with a preview requiring fresh explicit rights confirmation", async () => {
    render();
    await flush();
    let resolve!: (v: any) => void;
    mocks.picker.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    button(render(), "Choose a new image").props.onPress();
    mocks.appState!("inactive");
    mocks.appState!("active");
    resolve({
      canceled: false,
      assets: [{ uri: "file:input.jpg", width: 200, height: 100 }],
    });
    await flush();
    const tree = render();
    expect(
      nodes(tree, "Image").some(
        (image) => image.props.source.uri === "file:selected.jpg",
      ),
    ).toBe(true);
    const checkbox = nodes(tree, "Pressable").find(
      (node) => node.props.accessibilityRole === "checkbox",
    );
    expect(checkbox.props.accessibilityState.checked).toBe(false);
    expect(
      button(tree, "Confirm preview and submit for review").props.disabled,
    ).toBe(true);
    expect(
      mocks.request.mock.calls.some(
        ([options]) =>
          options.method === "POST" && options.path === "/v1/community/media",
      ),
    ).toBe(false);
  });
  it("discards late image conversion across a later manual background transition", async () => {
    render();
    await flush();
    let release!: (value: any) => void;
    mocks.save.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    button(render(), "Choose a new image").props.onPress();
    await flush();
    expect(mocks.save).toHaveBeenCalledOnce();
    mocks.appState!("inactive");
    mocks.appState!("active");
    release({ uri: "file:selected.jpg", base64: "AQIDBA==" });
    await flush();
    expect(
      nodes(render(), "Image").some(
        (image) => image.props.source.uri === "file:selected.jpg",
      ),
    ).toBe(false);
  });
});
