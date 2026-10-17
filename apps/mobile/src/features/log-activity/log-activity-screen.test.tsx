import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  back: vi.fn(),
  unitSystem: "metric",
  userId: "u",
}));
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
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
}));
vi.mock("react-native", () => ({
  ScrollView: "ScrollView",
  View: "View",
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock("expo-router", () => ({
  router: { back: mocks.back },
  Stack: { Screen: "StackScreen" },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "op-1" }));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/constants/theme", () => ({
  MaxContentWidth: 600,
  Spacing: { four: 16, three: 12 },
}));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  ChoiceChip: "ChoiceChip",
  ChoiceGroup: "ChoiceGroup",
  FormField: "FormField",
  FormStatus: "FormStatus",
  FormTextInput: "FormTextInput",
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: mocks.userId }, accessToken: "t" },
    profile: { unitSystem: mocks.unitSystem },
  }),
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { status: () => ({ configured: false }), request: vi.fn() },
  invalidateSessionReads: vi.fn(),
}));
vi.mock("./log-activity-data", () => ({ saveLoggedActivityWith: mocks.save }));

import { LogActivityScreen } from "./log-activity-screen";

const render = () => {
  hooks.index = 0;
  return LogActivityScreen();
};
function find(node: any, p: (n: any) => boolean): any {
  if (!node) return null;
  if (Array.isArray(node))
    return node.map((n) => find(n, p)).find(Boolean) ?? null;
  return p(node) ? node : find(node.props?.children, p);
}
const byLabel = (tree: any, label: string) =>
  find(tree, (n) => n.props?.accessibilityLabel === label);
const chip = (tree: any, label: string) =>
  find(tree, (n) => n.type === "ChoiceChip" && n.props.label === label);
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

beforeEach(() => {
  hooks.slots = [];
  hooks.index = 0;
  mocks.unitSystem = "metric";
  mocks.userId = "u";
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({
    ok: false,
    message: "Network unavailable.",
    workoutRequested: true,
    retryable: true,
  });
});

describe("log activity screen", () => {
  it("shows distance for Swimming and hides it for Jump Rope", () => {
    let tree = render();
    expect(byLabel(tree, "Distance (m, optional)")).toBeTruthy();
    chip(tree, "Jump Rope").props.onPress();
    tree = render();
    expect(
      find(tree, (n) =>
        String(n.props?.accessibilityLabel).startsWith("Distance"),
      ),
    ).toBeNull();
    chip(tree, "Outdoor Cycling").props.onPress();
    tree = render();
    expect(byLabel(tree, "Distance (km, optional)")).toBeTruthy();
  });

  it("blocks save on an invalid duration", async () => {
    let tree = render();
    byLabel(tree, "Save").props.onPress();
    await flush();
    tree = render();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(find(tree, (n) => n.type === "FormStatus")).toBeTruthy();
  });

  it("keeps the form locked and retries with the same operation", async () => {
    let tree = render();
    byLabel(tree, "Minutes").props.onChangeText("45");
    tree = render();
    byLabel(tree, "Save").props.onPress();
    await flush();
    tree = render();
    expect(mocks.save.mock.calls[0]?.[1]).toMatchObject({
      ownerId: "u",
      operationId: "op-1",
      durationSeconds: 2700,
    });
    expect(byLabel(tree, "Minutes").props.editable).toBe(false);
    mocks.save.mockResolvedValue({ ok: true, workout: {} });
    byLabel(tree, "Retry save").props.onPress();
    await flush();
    expect(mocks.save.mock.calls[1]?.[1]).toBe(mocks.save.mock.calls[0]?.[1]);
    expect(mocks.back).toHaveBeenCalled();
  });

  const startSave = async () => {
    let tree = render();
    byLabel(tree, "Minutes").props.onChangeText("45");
    tree = render();
    byLabel(tree, "Save").props.onPress();
    await flush();
    return render();
  };

  it("unlocks the form when nothing reached the server", async () => {
    mocks.save.mockResolvedValue({
      ok: false,
      message: "Multiple saved exercises match Swimming.",
      workoutRequested: false,
      retryable: true,
    });
    const tree = await startSave();
    expect(byLabel(tree, "Minutes").props.editable).toBe(true);
    expect(byLabel(tree, "Save")).toBeTruthy();
  });

  it("offers Close instead of Retry when resending cannot succeed", async () => {
    mocks.save.mockResolvedValue({
      ok: false,
      message: "The server already has a different activity for this save.",
      workoutRequested: true,
      retryable: false,
    });
    const tree = await startSave();
    expect(byLabel(tree, "Retry save")).toBeNull();
    byLabel(tree, "Close").props.onPress();
    expect(mocks.back).toHaveBeenCalled();
  });

  it("never retries one account's plan under another account", async () => {
    let tree = await startSave();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    mocks.userId = "other";
    tree = render();
    byLabel(tree, "Retry save").props.onPress();
    await flush();
    tree = render();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(byLabel(tree, "Minutes").props.editable).toBe(true);
    expect(
      String(find(tree, (n) => n.type === "FormStatus")?.props.children),
    ).toContain("switched accounts");
  });

  it("stays locked after a later attempt fails before the workout step", async () => {
    // Attempt 1: the workout POST's response is lost.
    mocks.save.mockRejectedValueOnce(new Error("lost"));
    let tree = await startSave();
    // Attempt 2: still offline, fails at the exercise list.
    mocks.save.mockResolvedValueOnce({
      ok: false,
      message: "Network unavailable.",
      workoutRequested: false,
      retryable: true,
    });
    byLabel(tree, "Retry save").props.onPress();
    await flush();
    tree = render();
    expect(byLabel(tree, "Minutes").props.editable).toBe(false);
    mocks.save.mockResolvedValueOnce({ ok: true, workout: {} });
    byLabel(tree, "Retry save").props.onPress();
    await flush();
    const plans = mocks.save.mock.calls.map((call) => call[1]);
    expect(plans).toHaveLength(3);
    expect(new Set(plans.map((p) => p.operationId)).size).toBe(1);
    expect(mocks.back).toHaveBeenCalled();
  });
});
