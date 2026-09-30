import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enroll: vi.fn(),
  load: vi.fn(),
  update: vi.fn(),
  withdraw: vi.fn(),
  replace: vi.fn(),
  state: {} as any,
  form: {} as any,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => [
    typeof initial === "function" ? mocks.form : initial,
    vi.fn(),
  ],
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void) => effect(),
}));
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
  View: "View",
}));
vi.mock("expo-router", () => ({
  router: { replace: mocks.replace, push: vi.fn() },
  Stack: { Screen: "StackScreen" },
  useFocusEffect: (callback: () => void) => callback(),
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "Text" }));
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
  return expand(CommunitySettingsScreen(props));
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (Array.isArray(node))
    return node.map((item) => find(item, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
function button(tree: any, label: string): any {
  return find(
    tree,
    (node) =>
      node.type === "Pressable" &&
      node.props.children?.props?.children === label,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
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
    expect(find(tree, (node) => node.type === "StackScreen")).toBeFalsy();
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
    expect(find(render(), (node) => node.type === "StackScreen")).toBeTruthy();
    expect(button(render(), "Account export and deletion")).toBeTruthy();
  });
});
