import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enroll: vi.fn(),
  load: vi.fn(),
  update: vi.fn(),
  withdraw: vi.fn(),
  replace: vi.fn(),
  state: {} as any,
  form: {} as any,
  task: undefined as string | undefined,
}));
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const index = hooks.index++;
    if (!(index in hooks.slots))
      hooks.slots[index] = typeof initial === "function" ? mocks.form : initial;
    return [
      hooks.slots[index],
      (next: any) => {
        hooks.slots[index] =
          typeof next === "function" ? next(hooks.slots[index]) : next;
      },
    ];
  },
  useRef: (current: unknown) => {
    const index = hooks.index++;
    return (hooks.slots[index] ??= { current });
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void) => effect(),
}));
vi.mock("./ui", () => ({ CommunityPage: "CommunityPage" }));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: vi.fn() },
  AppState: { addEventListener: vi.fn() },
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "ios", select: (values: any) => values.ios },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  TextInput: "TextInput",
  Text: "Text",
  View: "View",
}));
vi.mock("expo-router", () => ({
  router: { replace: mocks.replace, push: vi.fn() },
  useLocalSearchParams: () => ({ task: mocks.task }),
  useFocusEffect: (callback: () => void) => callback(),
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "Text" }));
vi.mock("expo-symbols", () => ({ SymbolView: "SymbolView" }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/composition/community-admission", () => ({
  COMMUNITY_ENROLLMENT_OPEN: true,
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "account-a" } },
    profile: { birthYear: 1990 },
  }),
}));
vi.mock("./initials-avatar", () => ({ InitialsAvatar: "InitialsAvatar" }));
vi.mock("./use-community-profile", () => ({
  useCommunityProfile: () => ({
    state: mocks.state,
    actions: {
      enroll: mocks.enroll,
      load: mocks.load,
      update: mocks.update,
      withdraw: mocks.withdraw,
    },
  }),
}));
import { CommunitySettingsScreen } from "./community-settings-screen";
import { COMMUNITY_CONTEXT_CHANGED_MESSAGE } from "./community-client";

// Render output and explicit handlers only; native layout acceptance is separate.
function render(
  props: Parameters<typeof CommunitySettingsScreen>[0] = {},
): any {
  function expand(node: any): any {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") return expand(node.type(node.props));
    return {
      ...node,
      props: { ...node.props, children: expand(node.props.children) },
    };
  }
  hooks.index = 0;
  return expand(CommunitySettingsScreen(props));
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (Array.isArray(node))
    return node.map((item) => find(item, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
function textContent(node: any): string {
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object"
    ? textContent(node.props?.children)
    : "";
}
function button(tree: any, label: string): any {
  return find(
    tree,
    (node) =>
      node.type === "Pressable" &&
      (node.props.accessibilityLabel === label ||
        node.props.children?.props?.children === label),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  hooks.slots = [];
  mocks.task = undefined;
  mocks.state = {
    status: "ready",
    profile: null,
    isEnrolled: false,
    isWithdrawn: false,
    isAdultEligible: true,
    isSaving: false,
    error: null,
  };
  mocks.form = {
    handle: "friend_a",
    displayName: "Friend",
    avatarSymbol: "",
    bio: "",
    adultDeclaration: true,
    acceptedTerms: true,
    isSearchable: false,
  };
  mocks.enroll.mockResolvedValue({ ok: true, value: {} });
});
describe("embedded Community joining", () => {
  it("owns no Stack header and omits member/account utility links without enrolling on render", () => {
    const tree = render({ embedded: true });
    expect(find(tree, (node) => node.type === "CommunityPage")).toBeFalsy();
    expect(button(tree, "Requests, followers and safety lists")).toBeFalsy();
    expect(button(tree, "Community inbox")).toBeFalsy();
    expect(button(tree, "Account export and deletion")).toBeFalsy();
    expect(button(tree, "Read Community rules and privacy")).toBeTruthy();
    expect(button(tree, "Keep tracking privately")).toBeTruthy();
    expect(mocks.enroll).not.toHaveBeenCalled();
  });
  it("waits for verified membership after explicit enrollment and does not notify on failure", async () => {
    const joined = vi.fn();
    const tree = render({ embedded: true, onJoined: joined });
    button(tree, "Join Community").props.onPress();
    await Promise.resolve();
    expect(mocks.enroll).toHaveBeenCalledTimes(1);
    expect(mocks.enroll.mock.calls[0][0].isSearchable).toBe(false);
    expect(joined).not.toHaveBeenCalled();
    mocks.enroll.mockResolvedValue({
      ok: false,
      error: { kind: "network_error" },
    });
    button(tree, "Join Community").props.onPress();
    await Promise.resolve();
    expect(joined).not.toHaveBeenCalled();
  });
  it("notifies verified active membership recovered by a status read without enrolling", () => {
    const joined = vi.fn();
    mocks.state.isEnrolled = true;
    render({ embedded: true, onJoined: joined });
    expect(joined).toHaveBeenCalledTimes(1);
    expect(mocks.enroll).not.toHaveBeenCalled();
    joined.mockClear();
    mocks.state.status = "loading";
    render({ embedded: true, onJoined: joined });
    expect(joined).not.toHaveBeenCalled();
  });
  it("requires deliberate consent before enrollment and keeps the standalone settings header", () => {
    mocks.form.acceptedTerms = false;
    const tree = render({ embedded: true });
    const join = button(tree, "Join Community");
    expect(join.props.disabled).toBe(true);
    join.props.onPress();
    expect(mocks.enroll).not.toHaveBeenCalled();
    expect(
      find(render(), (node) => node.type === "CommunityPage"),
    ).toBeTruthy();
    expect(button(render(), "Account export and deletion")).toBeTruthy();
  });
  it("keeps audience, history and separate unchecked declarations visible before joining", () => {
    mocks.form.adultDeclaration = false;
    mocks.form.acceptedTerms = false;
    const tree = render({ embedded: true });
    const copy = textContent(tree);
    expect(copy).toContain("including earlier cards still shared");
    expect(copy).toContain("following someone does not let them follow you");
    expect(copy).toContain("Nothing is copied from your private profile");
    const adult = find(
      tree,
      (node) => node.props?.accessibilityLabel === "I am 18 or older",
    );
    const consent = find(
      tree,
      (node) =>
        node.props?.accessibilityLabel ===
        "I accept the Community rules (2026-09-30)",
    );
    expect(adult.props.accessibilityState.checked).toBe(false);
    expect(consent.props.accessibilityState.checked).toBe(false);
    expect(button(tree, "Join Community").props.disabled).toBe(true);
    expect(mocks.enroll).not.toHaveBeenCalled();
  });
  it.each(["loading", "error"])(
    "shows status recovery instead of the joining form while %s",
    (status) => {
      mocks.state.status = status;
      const tree = render({ embedded: true });
      expect(button(tree, "Join Community")).toBeFalsy();
      expect(button(tree, "Keep tracking privately")).toBeTruthy();
      if (status === "error") {
        button(tree, "Check Community status").props.onPress();
        expect(mocks.load).toHaveBeenCalled();
        expect(button(tree, "Leave Community")).toBeTruthy();
      }
      expect(mocks.enroll).not.toHaveBeenCalled();
    },
  );
  it("names an interrupted status check without claiming an unconfirmed change", () => {
    mocks.state.status = "error";
    mocks.state.error = COMMUNITY_CONTEXT_CHANGED_MESSAGE;
    const copy = textContent(render({ embedded: true }));
    expect(copy).toContain("We could not check your status");
    expect(copy).toContain("Your status check was interrupted.");
    expect(copy).not.toContain("Check your status before trying again");
    expect(copy).not.toContain("Always your choice");
  });
  it("asks for a fresh check after an ambiguous join", async () => {
    mocks.enroll.mockImplementation(async () => {
      mocks.state.status = "error";
      mocks.state.error = "Network request failed.";
      return { ok: false };
    });
    button(render({ embedded: true }), "Join Community").props.onPress();
    await Promise.resolve();
    await Promise.resolve();
    const copy = textContent(render({ embedded: true }));
    expect(copy).toContain("Your changes are not confirmed");
    expect(copy).toContain("Check your status before trying again");
  });
  it("keeps the conservative birth-year gate and private exit when ineligible", () => {
    mocks.state.isAdultEligible = false;
    const tree = render({ embedded: true });
    expect(button(tree, "Join Community")).toBeFalsy();
    expect(textContent(tree)).toContain(
      String(new Date().getUTCFullYear() - 19),
    );
    expect(textContent(tree)).toContain("does not verify identity or birthday");
    button(tree, "Keep tracking privately").props.onPress();
    expect(mocks.replace).toHaveBeenCalledWith("/(tabs)");
    expect(mocks.enroll).not.toHaveBeenCalled();
  });
  it("reserves a withdrawn handle and requires fresh consent without recovering history", () => {
    mocks.state.isWithdrawn = true;
    mocks.state.profile = {
      userId: "account-a",
      generation: 2,
      status: "withdrawn",
      handle: "friend_a",
    };
    mocks.form.acceptedTerms = false;
    mocks.form.adultDeclaration = false;
    const tree = render({ embedded: true });
    const handle = find(
      tree,
      (node) =>
        node.type === "TextInput" && node.props.accessibilityLabel === "Handle",
    );
    expect(handle.props.editable).toBe(false);
    expect(textContent(tree)).toContain(
      "Previous follows, cards and invitations do not return",
    );
    expect(button(tree, "Join Community").props.disabled).toBe(true);
    expect(button(tree, "Leave Community")).toBeFalsy();
    expect(mocks.enroll).not.toHaveBeenCalled();
  });
  it("opens enrolled settings as choices and keeps identity fields in the explicit editor", () => {
    mocks.state.isEnrolled = true;
    mocks.state.profile = {
      userId: "account-a",
      generation: 2,
      status: "active",
      handle: "friend_a",
      displayName: "Friend",
      avatarSymbol: "FR",
      bio: null,
      isSearchable: false,
    };
    const tree = render();
    expect(button(tree, "Edit social identity")).toBeTruthy();
    expect(find(tree, (node) => node.type === "TextInput")).toBeFalsy();
    expect(button(tree, "Save discovery choice")).toBeTruthy();
    expect(button(tree, "Account export and deletion")).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("discards cancelled identity edits before saving an independent discovery choice", async () => {
    mocks.state.isEnrolled = true;
    mocks.state.profile = {
      userId: "account-a",
      generation: 2,
      status: "active",
      handle: "friend_a",
      displayName: "Saved name",
      avatarSymbol: "SN",
      bio: null,
      isSearchable: false,
    };
    render();
    button(render(), "Edit social identity").props.onPress();
    const field = find(
      render(),
      (node) =>
        node.type === "TextInput" &&
        node.props.accessibilityLabel === "Social display name",
    );
    field.props.onChangeText("Cancelled name");
    button(render(), "Cancel identity editing").props.onPress();
    expect(find(render(), (node) => node.type === "TextInput")).toBeFalsy();
    mocks.update.mockResolvedValue({ ok: true });
    button(render(), "Save discovery choice").props.onPress();
    await Promise.resolve();
    expect(mocks.update.mock.calls[0][0].displayName).toBe("Saved name");
    expect(mocks.update.mock.calls[0][0].isSearchable).toBe(false);
  });
  it("saves an enrolled profile independently of join-only declarations", async () => {
    mocks.state.isEnrolled = true;
    mocks.state.profile = {
      userId: "account-a",
      generation: 2,
      status: "active",
      handle: "friend_a",
      displayName: "Friend",
      avatarSymbol: "FR",
      bio: null,
      isSearchable: false,
    };
    mocks.form.acceptedTerms = false;
    mocks.form.adultDeclaration = false;
    mocks.update.mockResolvedValue({ ok: true });
    mocks.task = "identity";
    const tree = render();
    expect(button(tree, "Join Community")).toBeFalsy();
    expect(
      find(
        tree,
        (node) => node.props?.accessibilityLabel === "I am 18 or older",
      ),
    ).toBeFalsy();
    button(tree, "Save Community profile").props.onPress();
    await Promise.resolve();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty("acceptedTerms");
    expect(mocks.enroll).not.toHaveBeenCalled();
  });
});
