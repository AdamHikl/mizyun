import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  changed: false,
  effects: [] as (() => void)[],
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
  Platform: { OS: "ios" },
  Linking: { openURL: vi.fn() },
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
  vi.clearAllMocks();
});
import { apiClient } from "@/composition/api-client";
import { ReportModal, type ReportModalProps } from "./report-modal";

const props: ReportModalProps = {
  visible: true,
  targetType: "profile",
  targetId: "target",
  principalKey: "account-a",
  onClose: vi.fn(),
};
const contact = {
  available: false,
  contactEmail: null,
  standardsUrl: null,
  emergencyAdvice: "Local emergency services",
  ordinaryResponseHours: 24,
  urgentResponseHours: 4,
};
const received = {
  ok: true,
  value: {
    id: "report-a",
    status: "submitted",
    createdAt: "2026-09-30T12:00:00Z",
    safetyContact: null,
    message: "Received",
    blocked: false,
  },
};
function chooseReason(p = props) {
  let tree = render(ReportModal, p);
  find(tree, "Harassment, bullying, or hate").props.onPress();
  tree = render(ReportModal, p);
  return tree;
}
describe("ReportModal safety lifetime", () => {
  it("ignores account A report response after account switch and clears private draft", async () => {
    const pending = deferred<any>();
    vi.mocked(apiClient.request).mockImplementation(async (options) =>
      options.path.endsWith("/contact")
        ? ({ ok: true, value: contact } as any)
        : pending.promise,
    );
    const success = vi.fn();
    const accountA = { ...props, onSuccess: success };
    const tree = chooseReason(accountA);
    find(tree, "Additional report details").props.onChangeText(
      "Account A confidential evidence",
    );
    const sending = find(
      render(ReportModal, accountA),
      "Submit community report",
    ).props.onPress();
    const accountB = { ...accountA, principalKey: "account-b" };
    render(ReportModal, accountB);
    pending.resolve(received);
    await sending;
    const next = render(ReportModal, accountB);
    expect(success).not.toHaveBeenCalled();
    expect(JSON.stringify(next)).not.toContain(
      "Account A confidential evidence",
    );
    expect(JSON.stringify(next)).not.toContain("report-a");
    const request = vi
      .mocked(apiClient.request)
      .mock.calls.find(([options]) => options.path.endsWith("/reports"))![0];
    expect(request.expectedUserId).toBe("account-a");
    expect(request.isCurrent?.()).toBe(false);
  });
  it("ignores a late response after closing or changing target", async () => {
    const pending = deferred<any>();
    vi.mocked(apiClient.request).mockImplementation(async (options) =>
      options.path.endsWith("/contact")
        ? ({ ok: true, value: contact } as any)
        : pending.promise,
    );
    const success = vi.fn();
    const initial = { ...props, onSuccess: success };
    const sending = find(
      chooseReason(initial),
      "Submit community report",
    ).props.onPress();
    render(ReportModal, {
      ...initial,
      visible: false,
      targetId: "other-target",
    });
    pending.resolve(received);
    await sending;
    expect(success).not.toHaveBeenCalled();
  });
  it("does not claim optional blocking succeeded when server returns blocked false", async () => {
    vi.mocked(apiClient.request).mockImplementation(async (options) =>
      options.path.endsWith("/contact")
        ? ({ ok: true, value: contact } as any)
        : (received as any),
    );
    const success = vi.fn();
    const initial = { ...props, onSuccess: success };
    find(chooseReason(initial), "Also block this profile").props.onPress();
    await find(
      render(ReportModal, initial),
      "Submit community report",
    ).props.onPress();
    const tree = render(ReportModal, initial);
    expect(success).toHaveBeenCalledWith("report-a", false);
    expect(JSON.stringify(tree)).toContain("blocking was not confirmed");
    expect(JSON.stringify(tree)).not.toContain("You have blocked");
    expect(JSON.stringify(tree)).not.toContain("safety@mizyun.com");
  });
  it("shows unconfirmed submission and keeps retry available on offline failure", async () => {
    vi.mocked(apiClient.request).mockResolvedValue({
      ok: false,
      error: { kind: "network_error", message: "offline" },
    } as any);
    await find(chooseReason(), "Submit community report").props.onPress();
    const tree = render(ReportModal, props);
    expect(JSON.stringify(tree)).toContain("Report not confirmed");
    expect(JSON.stringify(tree)).not.toContain("Report Submitted");
    expect(find(tree, "Submit community report").props.disabled).toBe(false);
  });
});
