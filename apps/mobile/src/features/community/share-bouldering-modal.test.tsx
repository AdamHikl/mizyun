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
  enrolled: true,
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
    isEnrolled: mocks.enrolled,
    status: "ready",
    error: null,
    actions: { load: mocks.load },
  }),
}));
vi.mock("./community-client", () => ({
  fetchBoulderingSharePreview: mocks.fetch,
  humanizeCommunityError: () => "Failed",
  unpublishActivity: mocks.revoke,
  publishBoulderingActivity: vi.fn(),
}));
vi.mock("./share-bouldering-actions", async (original) => ({
  ...(await original<typeof import("./share-bouldering-actions")>()),
  saveBoulderingShare: mocks.save,
}));
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
vi.mock("./shared-bouldering-details", async () => ({
  ...(await import("./bouldering-card-text")),
  SharedBoulderingDetails: "SharedBoulderingDetails",
}));
vi.mock("./feed/formatters", () => ({
  formatSharedDay: (day: string) => `day:${day}`,
}));
import { ShareBoulderingModal } from "./share-bouldering-modal";
vi.mock("./state/read-cache", () => ({
  COMMUNITY_READ_LIFETIME_MS: 10_000,
  getCommunityReadEpoch: () => mocks.epoch,
}));
const SESSION = "00000000-0000-4000-8000-0000000000b1";
const plain = {
  activityDate: "2026-10-16",
  topGrade: "6C",
  sends: 9,
  flashes: 4,
  gradeBreakdown: null,
};
const withBreakdown = {
  ...plain,
  gradeBreakdown: [
    { grade: "6C", sends: 2 },
    { grade: "6B", sends: 7 },
  ],
};
const preview = (existingActivity: any = null, overrides: any = {}) => ({
  sessionId: SESSION,
  enrollmentGeneration: 1,
  sharedDay: "2026-10-16",
  boulderingDetails: plain,
  boulderingDetailsWithBreakdown: withBreakdown,
  followerCount: 3,
  existingActivity,
  ...overrides,
});
const props = {
  visible: true,
  sessionId: SESSION,
  onDismiss: () => mocks.dismiss(),
};
function render(overrides: any = {}): any {
  hooks.index = 0;
  const tree = ShareBoulderingModal({ ...props, ...overrides });
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
  const { label, title, message, subtitle } = node.props ?? {};
  return [label, title, subtitle, message, text(node.props?.children)]
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
  return find(tree, (node) => node.props?.label === label);
}
function toggle(tree: any): any {
  return find(
    tree,
    (node) => node.props?.accessibilityLabel === "Include grade breakdown",
  );
}
function card(tree: any): any {
  return find(tree, (node) => node.type === "SharedBoulderingDetails");
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
  mocks.enrolled = true;
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue({ ok: true, value: preview() });
  mocks.save.mockResolvedValue({ ok: true, value: { id: "activity-a" } });
  mocks.revoke.mockResolvedValue({ ok: true, value: { revoked: true } });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("bouldering sharing sheet", () => {
  it("shows the exact server projection, audience and what stays private", async () => {
    const tree = await load();
    expect(mocks.fetch).toHaveBeenCalledWith(expect.anything(), SESSION);
    expect(card(tree).props.details).toBe(plain);
    const copy = text(tree);
    expect(copy).toContain("Bouldering · Top grade 6C");
    expect(copy).toContain("day:2026-10-16");
    expect(copy).toMatch(/3\s+currently approved/);
    expect(copy).toContain(
      "gym name, notes, photos, hold colours, attempts and times",
    );
    expect(button(tree, "Publish session")).toBeTruthy();
    expect(button(tree, "Unpublish session")).toBeFalsy();
  });
  it("toggles between the two server projections and publishes the chosen one", async () => {
    let tree = await load();
    expect(toggle(tree).props.accessibilityState.checked).toBe(false);
    toggle(tree).props.onPress();
    tree = render();
    expect(toggle(tree).props.accessibilityState.checked).toBe(true);
    expect(card(tree).props.details).toBe(withBreakdown);
    await button(tree, "Publish session").props.onPress();
    expect(mocks.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: SESSION,
        includeGradeBreakdown: true,
        operationId: "operation-id",
        enrollmentGeneration: 1,
      }),
    );
    expect(mocks.dismiss).toHaveBeenCalledOnce();
  });
  it("hides the breakdown option when the session has no sends", async () => {
    const empty = {
      ...plain,
      topGrade: null,
      sends: 0,
      flashes: 0,
    };
    mocks.fetch.mockResolvedValue({
      ok: true,
      value: preview(null, {
        boulderingDetails: empty,
        boulderingDetailsWithBreakdown: { ...empty, gradeBreakdown: [] },
      }),
    });
    const tree = await load();
    expect(toggle(tree)).toBeUndefined();
    expect(text(tree)).toContain("Bouldering · No sends");
  });
  it("prevents duplicate taps while a publish is unresolved", async () => {
    let resolve: any;
    mocks.save.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const publish = button(await load(), "Publish session").props.onPress;
    const pending = publish();
    await publish();
    expect(mocks.save).toHaveBeenCalledOnce();
    resolve({ ok: true, value: { id: "activity-a" } });
    await pending;
    expect(mocks.dismiss).toHaveBeenCalledOnce();
  });
  it("replays the same operation and projection after a lost response", async () => {
    mocks.save
      .mockResolvedValueOnce({ ok: false, error: { kind: "network_error" } })
      .mockResolvedValueOnce({ ok: true, value: { id: "activity-a" } });
    await button(await load(), "Publish session").props.onPress();
    await button(render(), "Retry sharing").props.onPress();
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[0]![1]).toEqual(mocks.save.mock.calls[1]![1]);
    expect(mocks.dismiss).toHaveBeenCalledOnce();
  });
  it.each([
    [409, "CONFLICT"],
    [404, "NOT_FOUND"],
    [422, "WORKOUT_NOT_COMPLETED"],
    [503, "FEATURE_DISABLED"],
    [403, "COMMUNITY_NOT_ENROLLED"],
  ])(
    "retires the preview on HTTP %i %s and requires an explicit reload",
    async (status, code) => {
      mocks.save.mockResolvedValue({
        ok: false,
        error: { kind: "http_error", status, code, message: "x" },
      });
      await button(await load(), "Publish session").props.onPress();
      let tree = render();
      expect(button(tree, "Retry sharing")).toBeFalsy();
      expect(card(tree)).toBeFalsy();
      const reload = button(tree, "Reload session preview");
      expect(reload).toBeTruthy();
      mocks.fetch.mockResolvedValue({
        ok: true,
        value: preview({
          id: "card-a",
          version: 2,
          revokedAt: null,
          boulderingDetails: plain,
        }),
      });
      reload.props.onPress();
      render();
      await Promise.resolve();
      await Promise.resolve();
      tree = render();
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      expect(button(tree, "Update shared session")).toBeTruthy();
    },
  );
  it.each([
    ["FEATURE_DISABLED", 503, "isn't available"],
    ["WORKOUT_NOT_COMPLETED", 422, "Finish the session"],
    ["NOT_FOUND", 404, "no longer available"],
  ])("explains a %s preview failure", async (code, status, message) => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      error: { kind: "http_error", status, code, message: "x" },
    });
    const tree = await load();
    expect(text(tree)).toContain(message);
    expect(button(tree, "Publish session")).toBeFalsy();
  });
  it("explains offline preview failure with a reload action", async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      error: { kind: "network_error" },
    });
    const tree = await load();
    expect(text(tree)).toContain("Failed");
    expect(button(tree, "Reload session preview")).toBeTruthy();
  });
  it("expires a preview and rejects a saved old publish handler", async () => {
    const publish = button(await load(), "Publish session").props.onPress;
    vi.advanceTimersByTime(10_000);
    await publish();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(text(render())).toContain("Reload the session preview");
  });
  it.each(["account", "token", "background", "source", "epoch"])(
    "retires the preview and old handlers on %s change",
    async (change) => {
      const publish = button(await load(), "Publish session").props.onPress;
      if (change === "account") mocks.principal = "account-b";
      if (change === "token") mocks.token = "token-b";
      if (change === "background") mocks.appState!("background");
      if (change === "epoch") mocks.epoch++;
      const overrides =
        change === "source"
          ? { sessionId: "00000000-0000-4000-8000-0000000000b2" }
          : {};
      const tree = render(overrides);
      await publish();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(card(tree)).toBeFalsy();
    },
  );
  it("keeps a live card's breakdown choice and supports update and version-fenced unpublish", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      value: preview({
        id: "card-a",
        version: 3,
        revokedAt: null,
        boulderingDetails: withBreakdown,
      }),
    });
    mocks.revoke
      .mockResolvedValueOnce({ ok: false, error: { kind: "network_error" } })
      .mockResolvedValueOnce({ ok: true, value: { revoked: true } });
    let tree = await load({ existingActivityId: "card-a" });
    expect(toggle(tree).props.accessibilityState.checked).toBe(true);
    toggle(tree).props.onPress();
    tree = render({ existingActivityId: "card-a" });
    await button(tree, "Update shared session").props.onPress();
    expect(mocks.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        includeGradeBreakdown: false,
        existingActivityId: "card-a",
      }),
    );
    const native = await import("react-native");
    button(tree, "Unpublish session").props.onPress();
    const args = (native.Alert.alert as any).mock.calls[0];
    await args[2][1].onPress();
    await button(
      render({ existingActivityId: "card-a" }),
      "Retry unpublishing",
    ).props.onPress();
    expect(mocks.revoke).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "card-a",
      3,
    );
    expect(mocks.revoke).toHaveBeenCalledTimes(2);
  });
  it("offers Share again for a revoked card with breakdown off", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      value: preview({
        id: "card-a",
        version: 4,
        revokedAt: "2026-10-16T10:00:00.000Z",
        boulderingDetails: withBreakdown,
      }),
    });
    const tree = await load();
    expect(button(tree, "Share again")).toBeTruthy();
    expect(button(tree, "Unpublish session")).toBeFalsy();
    expect(toggle(tree).props.accessibilityState.checked).toBe(false);
  });
  it("refuses a different existing card than the one being managed", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      value: preview({ id: "card-b", version: 1, revokedAt: null }),
    });
    const tree = await load({ existingActivityId: "card-a" });
    expect(text(tree)).toContain("The shared card changed");
    expect(button(tree, "Update shared session")).toBeFalsy();
  });
  it("asks a user without an active Community profile to join instead of publishing", async () => {
    mocks.enrolled = false;
    const tree = await load();
    expect(text(tree)).toContain("Join Community to share sessions");
    expect(button(tree, "Publish session")).toBeFalsy();
    expect(card(tree)).toBeFalsy();
  });
  it("ends loading with a signed-out message", async () => {
    mocks.principal = null;
    const tree = await load();
    expect(text(tree)).toContain("Sign in to share a session");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
