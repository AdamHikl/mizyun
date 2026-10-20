import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  principal: "account-a" as string | null,
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
  IconBadge: "IconBadge",
  IconButton: "IconButton",
  ListGroup: "ListGroup",
  ListRow: "ListRow",
  Notice: "Notice",
  SectionHeader: "SectionHeader",
}));
vi.mock("@/components/ui/native-date-time-picker", () => ({
  NativeDatePicker: "NativeDatePicker",
  NativeTimePicker: "NativeTimePicker",
}));
vi.mock("@/constants/theme", () => ({
  PageGutter: 20,
  Radius: { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 },
  Spacing: { one: 4, two: 8, three: 16, four: 24, five: 32 },
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: mocks.principal ? { user: { id: mocks.principal } } : null,
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
  fetchWorkoutSharePreview: mocks.fetch,
  humanizeCommunityError: () => "Failed",
  unpublishActivity: vi.fn(),
}));
vi.mock("./share-workout-actions", () => ({ saveWorkoutShare: mocks.save }));
vi.mock("./scoped-client", () => ({ scopeCommunityClient: () => ({}) }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "operation-id" }));
vi.mock("./initials-avatar", () => ({ InitialsAvatar: "InitialsAvatar" }));
vi.mock("./shared-workout-details", () => ({
  SharedWorkoutDetails: "SharedWorkoutDetails",
}));
import { ShareWorkoutModal } from "./share-workout-modal";
const details = {
  exercises: [
    {
      name: "Bench press",
      sets: [
        {
          setType: "normal",
          repetitions: 8,
          loadKg: 60,
          durationSeconds: null,
        },
      ],
    },
  ],
};
const preview = (
  existingActivity: any = null,
  workoutDetails: any = details,
) => ({
  workoutId: "workout-a",
  enrollmentGeneration: 1,
  category: "strength",
  sharedDay: "2026-10-01",
  durationSeconds: 1200,
  followerCount: 1,
  existingActivity,
  workoutDetails,
});
const existing = {
  id: "activity-a",
  category: "strength",
  sharedDay: "2026-10-01",
  durationSeconds: null,
  revokedAt: null,
  workoutDetails: details,
};
const props = {
  visible: true,
  workoutId: "workout-a",
  onDismiss: () => mocks.dismiss(),
};
function render(): any {
  hooks.index = 0;
  const tree = ShareWorkoutModal(props);
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
async function load(): Promise<any> {
  render();
  await Promise.resolve();
  await Promise.resolve();
  return render();
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
function datePicker(node: any): any {
  return find(node, (child) => child.type === "NativeDatePicker");
}
function checkbox(tree: any): any {
  return find(
    tree,
    (node) =>
      node.props?.accessibilityLabel ===
      "Include exercises, sets, reps and weights",
  );
}
function publish(tree: any): any {
  return find(
    tree,
    (node) =>
      (node.type === "Pressable" || node.type === "Button") &&
      /^(Publish workout|Update shared workout)$/.test(text(node).trim()),
  );
}
beforeEach(() => {
  hooks.slots = [];
  hooks.index = 0;
  hooks.effects = [];
  mocks.principal = "account-a";
  mocks.appState = null;
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue({ ok: true, value: preview() });
  mocks.save.mockResolvedValue({ ok: true, value: { id: "activity-a" } });
});
describe("actual sharing modal selection and lifecycle", () => {
  it("ends loading with a closeable sign-in message when signed out", async () => {
    mocks.principal = null;
    const tree = await load();
    expect(text(tree)).toContain("Sign in to share a workout");
    expect(text(tree)).not.toContain("Preparing workout preview");
    expect(mocks.fetch).not.toHaveBeenCalled();
    find(
      tree,
      (node) => node.props?.accessibilityLabel === "Close",
    ).props.onPress();
    expect(mocks.dismiss).toHaveBeenCalledOnce();
  });

  it("sends one publication when Publish is tapped twice before re-rendering", async () => {
    let finish!: (value: unknown) => void;
    mocks.save.mockReturnValueOnce(
      new Promise((done) => {
        finish = done;
      }),
    );
    const tree = await load();
    const button = publish(tree);
    void button.props.onPress();
    void button.props.onPress();
    await Promise.resolve();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    finish({ ok: true, value: { id: "activity-a" } });
  });

  it("does not discard a sharing choice on an unchanged active event", async () => {
    let tree = await load();
    checkbox(tree).props.onPress();
    render();
    mocks.appState!("active");
    await Promise.resolve();
    tree = render();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(checkbox(tree).props.accessibilityState.checked).toBe(true);
  });

  it("shows the shared day in the date picker and publishes the picked day", async () => {
    let tree = await load();
    expect(datePicker(tree).props).toMatchObject({
      label: "Shared day",
      value: { year: 2026, month: 10, day: 1 },
    });
    datePicker(tree).props.onChange({ year: 2026, month: 10, day: 5 });
    tree = render();
    expect(datePicker(tree).props.value).toEqual({
      year: 2026,
      month: 10,
      day: 5,
    });
    await publish(tree).props.onPress();
    expect(mocks.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        preview: expect.objectContaining({ sharedDay: "2026-10-05" }),
      }),
    );
  });
  it("shows today in the date picker while the stored day is unreadable and keeps the stored value", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      value: { ...preview(), sharedDay: "" },
    });
    const tree = await load();
    const now = new Date();
    expect(datePicker(tree).props.value).toEqual({
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
    });
    await publish(tree).props.onPress();
    expect(mocks.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        preview: expect.objectContaining({ sharedDay: "" }),
      }),
    );
  });
  it("defaults a new workout to summary and requires an explicit detail choice", async () => {
    let tree = await load();
    expect(checkbox(tree).props.accessibilityState.checked).toBe(false);
    checkbox(tree).props.onPress();
    tree = render();
    expect(checkbox(tree).props.accessibilityState.checked).toBe(true);
    const projection = find(
      tree,
      (node) => node.type === "SharedWorkoutDetails",
    );
    expect(projection.props.details).toEqual(details);
    await publish(tree).props.onPress();
    expect(mocks.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        includeWorkoutDetails: true,
        preview: expect.objectContaining({ workoutDetails: details }),
      }),
    );
  });
  it("lets an existing detailed card become summary when current details are unavailable and discloses removal", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, value: preview(existing, null) });
    const tree = await load();
    expect(checkbox(tree)).toBeUndefined();
    expect(text(tree)).toContain(
      "removes the previously shared exercise and set details",
    );
    expect(publish(tree).props.disabled).toBe(false);
    await publish(tree).props.onPress();
    expect(mocks.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        includeWorkoutDetails: false,
        existingActivityId: "activity-a",
        preview: expect.objectContaining({ workoutDetails: null }),
      }),
    );
  });
  it("retires a selected detail preview on background and ignores its old publish handler", async () => {
    let tree = await load();
    checkbox(tree).props.onPress();
    tree = render();
    const oldPublish = publish(tree).props.onPress;
    mocks.appState?.("background");
    await oldPublish();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(text(render())).toContain("Preparing workout preview");
    mocks.appState?.("active");
    tree = await load();
    expect(checkbox(tree).props.accessibilityState.checked).toBe(false);
  });
  it("retires selection on principal switch and ignores the previous account's handler", async () => {
    let tree = await load();
    checkbox(tree).props.onPress();
    tree = render();
    const oldPublish = publish(tree).props.onPress;
    mocks.principal = "account-b";
    render();
    await oldPublish();
    expect(mocks.save).not.toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    tree = render();
    expect(checkbox(tree).props.accessibilityState.checked).toBe(false);
  });
});
