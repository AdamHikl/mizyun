import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  changed: false,
  effects: [] as (() => void)[],
  appState: null as null | ((state: string) => void),
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  const same = (a: any[], b: any[]) =>
    a?.length === b?.length &&
    a.every((value, index) => Object.is(value, b[index]));
  const effect = (callback: any, deps: any[]) => {
    const index = hooks.index++;
    const previous = hooks.slots[index];
    if (!previous || !same(previous.deps, deps)) {
      hooks.effects.push(() => {
        previous?.cleanup?.();
        hooks.slots[index].cleanup = callback();
      });
      hooks.slots[index] = { deps };
    }
  };
  return {
    ...actual,
    useState: (initial: any) => {
      const index = hooks.index++;
      if (!(index in hooks.slots))
        hooks.slots[index] =
          typeof initial === "function" ? initial() : initial;
      return [
        hooks.slots[index],
        (next: any) => {
          const value =
            typeof next === "function" ? next(hooks.slots[index]) : next;
          if (!Object.is(value, hooks.slots[index])) hooks.changed = true;
          hooks.slots[index] = value;
        },
      ];
    },
    useRef: (initial: any) => {
      const index = hooks.index++;
      return (hooks.slots[index] ??= { current: initial });
    },
    useEffect: effect,
    useCallback: (callback: any) => callback,
  };
});
vi.mock("../ui", () => ({ CommunityPage: "CommunityPage" }));
vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: "Text",
  View: "View",
  Pressable: "Pressable",
  Modal: "Modal",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  ActivityIndicator: "ActivityIndicator",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "ios", select: (values: any) => values.ios },
  Linking: { openURL: vi.fn() },
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, callback: (state: string) => void) => {
      hooks.appState = callback;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    background: "white",
    backgroundElement: "white",
    text: "black",
    textSecondary: "grey",
    primary: "green",
    border: "grey",
  }),
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: vi.fn(), status: vi.fn() },
}));

function render<P>(component: (props: P) => any, props: P) {
  let tree: any;
  let count = 0;
  do {
    hooks.index = 0;
    hooks.changed = false;
    tree = component(props);
    if (++count > 10) throw new Error("Render did not settle");
  } while (hooks.changed);
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
function find(node: any, label: string): any {
  if (!node) return null;
  if (node.props?.accessibilityLabel === label) return node;
  if (Array.isArray(node))
    return node.map((child) => find(child, label)).find(Boolean);
  return find(node.props?.children, label);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const flush = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};
beforeEach(() => {
  hooks.slots = [];
  hooks.index = 0;
  hooks.effects = [];
  hooks.changed = false;
  hooks.appState = null;
  vi.clearAllMocks();
});
vi.mock("expo-router", () => ({
  Stack: { Screen: "Screen" },
  router: { replace: vi.fn(), push: vi.fn() },
  useFocusEffect: (callback: any) => {
    const index = hooks.index++;
    if (!hooks.slots[index]) {
      hooks.slots[index] = true;
      hooks.effects.push(callback);
    }
  },
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: null }),
}));
import { apiClient } from "@/composition/api-client";
import { SafetyContent } from "./safety-screen";

const contact = {
  available: false,
  contactEmail: null,
  standardsUrl: null,
  emergencyAdvice: "Emergency services",
  ordinaryResponseHours: 24,
  urgentResponseHours: 4,
};
const report = {
  id: "case-a",
  targetType: "profile",
  targetId: "target-a",
  reason: "harassment",
  status: "submitted",
  createdAt: "today",
  updatedAt: "today",
};
function response(options: any) {
  if (options.path.endsWith("/contact")) return contact;
  if (options.path.endsWith("/receipts"))
    return [
      {
        id: "receipt-a",
        targetType: "profile",
        targetId: "target-a",
        expiresAt: "2026-10-01T12:00:00Z",
      },
    ];
  if (options.path.endsWith("/notices"))
    return [
      {
        id: "notice-a",
        targetType: "profile",
        targetId: "account-a",
        reason: "Harassment restriction",
        status: "resolved",
        createdAt: "today",
        decision: "suspend",
        actionTakenAt: "2026-09-30T12:00:00Z",
        suspensionExpiresAt: "2026-10-07T12:00:00Z",
      },
    ];
  return [report];
}
describe("Community restricted safety", () => {
  it("clears safety evidence and appeal drafts on background and rejects late replies", async () => {
    const pending = deferred<any>();
    vi.mocked(apiClient.request).mockImplementation(async (options) =>
      options.path.endsWith("/appeals")
        ? pending.promise
        : ({ ok: true, value: response(options) } as any),
    );
    render(SafetyContent, { principalKey: "account-a" });
    await flush();
    let tree = render(SafetyContent, { principalKey: "account-a" });
    find(tree, "Appeal decision notice-a").props.onPress();
    tree = render(SafetyContent, { principalKey: "account-a" });
    find(tree, "Appeal reason").props.onChangeText("Private appeal draft");
    const sending = find(
      render(SafetyContent, { principalKey: "account-a" }),
      "Submit appeal",
    ).props.onPress();
    hooks.appState?.("background");
    tree = render(SafetyContent, { principalKey: "account-a" });
    expect(JSON.stringify(tree)).not.toContain("case-a");
    expect(JSON.stringify(tree)).not.toContain("Private appeal draft");
    pending.resolve({ ok: true, value: { id: "appeal-a", status: "pending" } });
    await sending;
    await flush();
    expect(
      JSON.stringify(render(SafetyContent, { principalKey: "account-a" })),
    ).not.toContain("Appeal received");
    const request = vi
      .mocked(apiClient.request)
      .mock.calls.find(([options]) => options.path.endsWith("/appeals"))![0];
    expect(request.isCurrent?.()).toBe(false);
    hooks.appState?.("active");
    await flush();
    expect(
      JSON.stringify(render(SafetyContent, { principalKey: "account-a" })),
    ).toContain("case-a");
  });
  it("renders own reports, opaque recent references and appeal form without verified contact links", async () => {
    vi.mocked(apiClient.request).mockImplementation(
      async (options) => ({ ok: true, value: response(options) }) as any,
    );
    render(SafetyContent, { principalKey: "account-a" });
    await flush();
    let tree = render(SafetyContent, { principalKey: "account-a" });
    expect(JSON.stringify(tree)).toContain("case-a");
    expect(JSON.stringify(tree)).toContain("Verified");
    expect(find(tree, "Report recent profile interaction 1")).toBeTruthy();
    find(tree, "Appeal decision notice-a").props.onPress();
    tree = render(SafetyContent, { principalKey: "account-a" });
    expect(find(tree, "Appeal reason")).toBeTruthy();
    expect(JSON.stringify(tree)).not.toContain("reporterUserId");
    expect(JSON.stringify(tree)).not.toContain("mailto:");
  });
  it("drops stale safety history when account changes", async () => {
    const pending = deferred<any>();
    vi.mocked(apiClient.request).mockImplementation(async (options) =>
      options.expectedUserId === "account-a"
        ? pending.promise
        : ({ ok: true, value: [] } as any),
    );
    render(SafetyContent, { principalKey: "account-a" });
    render(SafetyContent, { principalKey: "account-b" });
    pending.resolve({ ok: true, value: [report] });
    await flush();
    const tree = render(SafetyContent, { principalKey: "account-b" });
    expect(JSON.stringify(tree)).not.toContain("case-a");
    await flush();
    const request = vi.mocked(apiClient.request).mock.calls[0][0];
    expect(request.isCurrent?.()).toBe(false);
  });
  it("shows offline history uncertainty while private tracking and account controls remain reachable", async () => {
    vi.mocked(apiClient.request).mockResolvedValue({
      ok: false,
      error: { kind: "network_error" },
    } as any);
    render(SafetyContent, { principalKey: "restricted-account" });
    await flush();
    const tree = render(SafetyContent, { principalKey: "restricted-account" });
    expect(JSON.stringify(tree)).toContain("No new report or appeal was sent");
    expect(find(tree, "Keep tracking privately")).toBeTruthy();
    expect(find(tree, "Account export and deletion")).toBeTruthy();
    expect(find(tree, "Refresh safety history").props.disabled).toBe(false);
  });
  it("shows confirmed restriction duration and sends an appeal for the selected own notice", async () => {
    vi.mocked(apiClient.request).mockImplementation(
      async (options) =>
        ({
          ok: true,
          value: options.path.endsWith("/appeals")
            ? { id: "appeal-a", status: "pending" }
            : options.path.includes("/appeals/")
              ? { id: "appeal-a", status: "approved" }
              : response(options),
        }) as any,
    );
    render(SafetyContent, { principalKey: "account-a" });
    await flush();
    let tree = render(SafetyContent, { principalKey: "account-a" });
    expect(JSON.stringify(tree)).toContain("Recorded restriction expiry");
    find(tree, "Appeal decision notice-a").props.onPress();
    tree = render(SafetyContent, { principalKey: "account-a" });
    find(tree, "Appeal reason").props.onChangeText("Please reconsider");
    await find(
      render(SafetyContent, { principalKey: "account-a" }),
      "Submit appeal",
    ).props.onPress();
    await flush();
    const request = vi
      .mocked(apiClient.request)
      .mock.calls.find(([options]) => options.path.endsWith("/appeals"))![0];
    expect(request.body).toEqual({
      reportId: "notice-a",
      reason: "Please reconsider",
    });
    expect(request.expectedUserId).toBe("account-a");
    expect(
      JSON.stringify(render(SafetyContent, { principalKey: "account-a" })),
    ).toContain("Appeal received");
    find(
      render(SafetyContent, { principalKey: "account-a" }),
      "Check appeal status",
    ).props.onPress();
    await flush();
    expect(
      JSON.stringify(render(SafetyContent, { principalKey: "account-a" })),
    ).toContain("approved");
    const statusRequest = vi
      .mocked(apiClient.request)
      .mock.calls.find(([options]) => options.path.includes("/appeals/"))![0];
    expect(statusRequest.expectedUserId).toBe("account-a");
  });
  it("drops account A appeal confirmation and reason after switching account", async () => {
    const pending = deferred<any>();
    vi.mocked(apiClient.request).mockImplementation(async (options) =>
      options.path.endsWith("/appeals")
        ? pending.promise
        : ({ ok: true, value: response(options) } as any),
    );
    render(SafetyContent, { principalKey: "account-a" });
    await flush();
    find(
      render(SafetyContent, { principalKey: "account-a" }),
      "Appeal decision notice-a",
    ).props.onPress();
    find(
      render(SafetyContent, { principalKey: "account-a" }),
      "Appeal reason",
    ).props.onChangeText("Private appeal A");
    const sending = find(
      render(SafetyContent, { principalKey: "account-a" }),
      "Submit appeal",
    ).props.onPress();
    render(SafetyContent, { principalKey: "account-b" });
    pending.resolve({ ok: true, value: { id: "appeal-a", status: "pending" } });
    await sending;
    await flush();
    const tree = render(SafetyContent, { principalKey: "account-b" });
    expect(JSON.stringify(tree)).not.toContain("Private appeal A");
    expect(JSON.stringify(tree)).not.toContain("Appeal received");
    await flush();
    const request = vi
      .mocked(apiClient.request)
      .mock.calls.find(([options]) => options.path.endsWith("/appeals"))![0];
    expect(request.isCurrent?.()).toBe(false);
  });
});
