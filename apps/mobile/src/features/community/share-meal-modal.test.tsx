import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  principal: "account-a" as string | null,
  token: "token-a",
  epoch: 0,
  revoke: vi.fn(),
  clientCurrent: null as null | (() => boolean),
  appState: null as null | ((state: string) => void),
  fetch: vi.fn(),
  save: vi.fn(),
  load: vi.fn(),
  dismiss: vi.fn(),
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
  const memo = (factory: () => any, deps: any[]) => {
    const i = hooks.index++;
    if (!hooks.slots[i] || !same(hooks.slots[i].deps, deps))
      hooks.slots[i] = { deps, value: factory() };
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
    useEffect: (callback: () => any, deps: any[]) => {
      const i = hooks.index++;
      const previous = hooks.slots[i];
      if (!previous || !same(previous.deps, deps)) {
        hooks.slots[i] = { deps };
        hooks.effects.push(() => {
          previous?.cleanup?.();
          hooks.slots[i].cleanup = callback();
        });
      }
    },
  };
});
vi.mock("react-native", () => ({
  Modal: "Modal",
  View: "View",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "ios" },
  Text: "Text",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: (value: unknown) => value },
  Alert: { alert: vi.fn() },
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocks.appState = listener;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  Chip: "Chip",
  FormField: "FormField",
  FormTextInput: "FormTextInput",
  Icon: "Icon",
  IconButton: "IconButton",
  ListGroup: "ListGroup",
  ListRow: "ListRow",
  Notice: "Notice",
  SectionHeader: "SectionHeader",
}));
vi.mock("@/constants/theme", () => ({
  PageGutter: 20,
  Spacing: { one: 4, two: 8, three: 16, four: 24, five: 32 },
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: mocks.principal
      ? { user: { id: mocks.principal }, accessToken: mocks.token }
      : null,
    profile: { birthYear: 1990 },
  }),
}));
vi.mock("@/composition/api-client", () => ({ apiClient: {} }));
vi.mock("./use-community-profile", () => ({
  useCommunityProfile: () => ({
    profile: { displayName: "Author", handle: "author", avatarSymbol: "AU" },
    isEnrolled: true,
    status: "ready",
    error: null,
    actions: { load: mocks.load },
  }),
}));
vi.mock("./community-client", () => ({
  fetchMealSharePreview: mocks.fetch,
  humanizeCommunityError: () => "Failed",
  unpublishActivity: mocks.revoke,
}));
vi.mock("./share-meal-actions", () => ({ saveMealShare: mocks.save }));
vi.mock("./scoped-client", () => ({
  scopeCommunityClient: (
    _client: unknown,
    _principal: unknown,
    current: () => boolean,
  ) => {
    mocks.clientCurrent = current;
    return {};
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "operation-id" }));
vi.mock("./initials-avatar", () => ({ InitialsAvatar: "InitialsAvatar" }));
vi.mock("./shared-meal-details", () => ({
  SharedMealDetails: "SharedMealDetails",
}));
import { ShareMealModal } from "./share-meal-modal";
vi.mock("./state/read-cache", () => ({
  COMMUNITY_READ_LIFETIME_MS: 10_000,
  getCommunityReadEpoch: () => mocks.epoch,
}));
const details = {
  name: "Oatmeal",
  caloriesKcal: 360,
  proteinG: 12,
  carbsG: 60,
  fatG: null,
};
const preview = (existingActivity: any = null) => ({
  mealId: "meal-a",
  enrollmentGeneration: 1,
  sharedDay: "2026-10-12",
  mealDetails: details,
  followerCount: 1,
  existingActivity,
});
const props = {
  visible: true,
  mealId: "meal-a",
  onDismiss: () => mocks.dismiss(),
};
function render(overrides: any = {}): any {
  hooks.index = 0;
  const tree = ShareMealModal({ ...props, ...overrides });
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
async function load(overrides: any = {}): Promise<any> {
  render(overrides);
  await Promise.resolve();
  await Promise.resolve();
  return render(overrides);
}
function text(node: any): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  // Design-system primitives carry copy in props rather than children.
  const { label, title, message } = node.props ?? {};
  return [label, title, message, text(node.props?.children)]
    .filter(Boolean)
    .join(" ");
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node))
    return node.map((child) => find(child, predicate)).find(Boolean);
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
function button(tree: any, label: string): any {
  return find(
    tree,
    (node) =>
      (node.type === "Pressable" || node.props?.label === label) &&
      text(node).trim() === label,
  );
}
function checkbox(tree: any): any {
  return find(
    tree,
    (node) => node.props?.accessibilityLabel === "Include calories and macros",
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  hooks.slots = [];
  hooks.index = 0;
  hooks.effects = [];
  mocks.principal = "account-a";
  mocks.token = "token-a";
  mocks.epoch = 0;
  mocks.appState = null;
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue({ ok: true, value: preview() });
  mocks.save.mockResolvedValue({ ok: true, value: { id: "activity-a" } });
  mocks.revoke.mockResolvedValue({ ok: true, value: { revoked: true } });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("meal sharing modal lifecycle", () => {
  it("retires an in-flight request scope when the meal selection changes", async () => {
    await load();
    const current = mocks.clientCurrent!;
    expect(current()).toBe(true);
    render({ mealId: "meal-b" });
    expect(current()).toBe(false);
  });
  it("prevents duplicate taps while a publish is unresolved and retires late completion", async () => {
    let resolve: any;
    mocks.save.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const publish = button(await load(), "Publish meal").props.onPress;
    const pending = publish();
    await publish();
    expect(mocks.save).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10_000);
    expect(text(render())).toContain("Reload the meal preview");
    resolve({ ok: true, value: { id: "activity-a" } });
    await pending;
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });

  it("ends loading with a closeable signed-out message", async () => {
    mocks.principal = null;
    const tree = await load();
    expect(text(tree)).toContain("Sign in to share a meal");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("defaults nutrition off and displays only the exact name projection until selected", async () => {
    let tree = await load();
    expect(checkbox(tree).props.accessibilityState.checked).toBe(false);
    expect(
      find(tree, (node) => node.type === "SharedMealDetails").props.details,
    ).toEqual({ ...details, caloriesKcal: null, proteinG: null, carbsG: null });
    checkbox(tree).props.onPress();
    tree = render();
    expect(
      find(tree, (node) => node.type === "SharedMealDetails").props.details,
    ).toEqual(details);
    await button(tree, "Publish meal").props.onPress();
    expect(mocks.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        includeNutrition: true,
        preview: expect.objectContaining({ mealDetails: details }),
      }),
    );
  });
  it("preserves immutable operation and projection on lost-response retry", async () => {
    mocks.save
      .mockResolvedValueOnce({ ok: false, error: { kind: "network_error" } })
      .mockResolvedValueOnce({ ok: true, value: { id: "activity-a" } });
    const tree = await load();
    await button(tree, "Publish meal").props.onPress();
    await button(render(), "Retry sharing").props.onPress();
    expect(mocks.save.mock.calls[0]![1]).toEqual(mocks.save.mock.calls[1]![1]);
    expect(mocks.dismiss).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 404, 409])(
    "retires denied or stale preview on HTTP %i and requires explicit reload",
    async (status) => {
      mocks.save.mockResolvedValue({
        ok: false,
        error: { kind: "http_error", status },
      });
      await button(await load(), "Publish meal").props.onPress();
      const tree = render();
      expect(button(tree, "Retry sharing")).toBeUndefined();
      expect(button(tree, "Reload meal preview")).toBeTruthy();
    },
  );
  it("expires a preview and rejects a saved old publish handler", async () => {
    const tree = await load();
    const publish = button(tree, "Publish meal").props.onPress;
    vi.advanceTimersByTime(10_000);
    await publish();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(text(render())).toContain("Reload the meal preview");
  });
  it("rejects a changed read epoch before publishing", async () => {
    const publish = button(await load(), "Publish meal").props.onPress;
    mocks.epoch++;
    await publish();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(text(render())).not.toContain("Oatmeal");
  });
  it.each(["account", "token", "background", "source"])(
    "retires sensitive preview and old handlers on %s change",
    async (change) => {
      let tree = await load();
      checkbox(tree).props.onPress();
      tree = render();
      const publish = button(tree, "Publish meal").props.onPress;
      if (change === "account") mocks.principal = "account-b";
      if (change === "token") mocks.token = "token-b";
      if (change === "background") mocks.appState!("background");
      const overrides = change === "source" ? { mealId: "meal-b" } : {};
      tree = render(overrides);
      await publish();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(text(tree)).not.toContain("Oatmeal");
    },
  );
  it("rejects slow preview completion after the authorization lifetime", async () => {
    let resolve: any;
    mocks.fetch.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render();
    vi.advanceTimersByTime(10_001);
    resolve({ ok: true, value: preview() });
    await Promise.resolve();
    await Promise.resolve();
    expect(text(render())).toContain("Reload the meal preview");
    expect(checkbox(render())).toBeUndefined();
  });
  it("supports existing-card nutrition removal and version-fenced revoke retry", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      value: preview({
        id: "card-a",
        version: 3,
        revokedAt: null,
        mealDetails: details,
        sharedDay: "2026-10-11",
      }),
    });
    mocks.revoke
      .mockResolvedValueOnce({ ok: false, error: { kind: "network_error" } })
      .mockResolvedValueOnce({ ok: true, value: { revoked: true } });
    let tree = await load();
    expect(checkbox(tree).props.accessibilityState.checked).toBe(true);
    checkbox(tree).props.onPress();
    tree = render();
    await button(tree, "Update shared meal").props.onPress();
    expect(mocks.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        includeNutrition: false,
        existingActivityId: "card-a",
      }),
    );
    // Reopen the retained editor; exercise the actual confirmation callback.
    const native = await import("react-native");
    button(tree, "Unpublish meal").props.onPress();
    const args = (native.Alert.alert as any).mock.calls[0];
    await args[2][1].onPress();
    await button(render(), "Retry unpublishing").props.onPress();
    expect(mocks.revoke).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "card-a",
      3,
    );
    expect(mocks.revoke).toHaveBeenCalledTimes(2);
  });
});
