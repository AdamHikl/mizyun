import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => any)[],
  hadSession: false,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const i = state.index++;
    if (!(i in state.slots)) state.slots[i] = initial;
    return [
      state.slots[i],
      (next: any) => {
        state.slots[i] =
          typeof next === "function" ? next(state.slots[i]) : next;
      },
    ];
  },
  useRef: (initial: any) =>
    (state.slots[state.index++] ??= { current: initial }),
  useEffect: (fn: any) => {
    state.effects.push(fn);
  },
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Image: "Image",
  Platform: { OS: "ios" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (s: any) => s },
  Text: "Text",
  View: "View",
}));
vi.mock("@mizyun/identity", () => ({ parseDeepLinkFragment: vi.fn() }));
vi.mock("expo-apple-authentication", () => ({
  isAvailableAsync: async () => false,
}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-web-browser", () => ({ maybeCompleteAuthSession: vi.fn() }));
vi.mock("@/components/brand-wordmark", () => ({ BrandWordmark: "Wordmark" }));
vi.mock("@/components/google-icon", () => ({ GoogleIcon: "GoogleIcon" }));
vi.mock("@/components/legal-links", () => ({ LegalLinks: "LegalLinks" }));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  FormTextInput: "FormTextInput",
  IconBadge: "IconBadge",
}));
vi.mock("@/composition/auth-client", () => ({ authClient: {} }));
vi.mock("@/composition/app-variant", () => ({ getAppVariant: () => "dev" }));
vi.mock("@/composition/mobile-config", () => ({
  mobileConfigResult: { ok: false },
}));
vi.mock("@/constants/theme", () => ({
  MaxContentWidth: 600,
  MinTouchTarget: 44,
  PageGutter: 20,
  Radius: {},
  Spacing: {},
}));
vi.mock("@/hooks/use-color-scheme", () => ({ useColorScheme: () => "light" }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("./auth-error-message", () => ({ authErrorMessage: vi.fn() }));
vi.mock("./auth-context", () => ({
  useAuth: () => ({ explorePreview: vi.fn() }),
}));
vi.mock("./loading-screen", () => ({ LoadingScreen: "LoadingScreen" }));
vi.mock("./auth-device-history", async (original) => ({
  ...(await original<typeof import("./auth-device-history")>()),
  loadDeviceHadSession: async () => state.hadSession,
}));
import { AuthScreen } from "./auth-screen";

const find = (n: any, predicate: (n: any) => boolean): any =>
  Array.isArray(n)
    ? n.map((x) => find(x, predicate)).find(Boolean)
    : n && typeof n === "object"
      ? predicate(n)
        ? n
        : find(n.props?.children, predicate)
      : null;
const render = () => {
  state.index = 0;
  state.effects = [];
  return AuthScreen();
};
const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};
const openScreen = async () => {
  render();
  state.effects.forEach((effect) => effect());
  await settle();
  return render();
};
const labelled = (tree: any, label: string) =>
  find(tree, (n) => n.props?.label === label);

beforeEach(() => {
  state.slots = [];
  state.hadSession = false;
});

describe("AuthScreen entry mode", () => {
  it("waits for the device history instead of flashing sign-in", () => {
    expect(render().type).toBe("LoadingScreen");
  });

  it("opens on sign-up for a device that never had a session, with sign-in one tap away", async () => {
    const tree = await openScreen();
    expect(labelled(tree, "Create account")).toBeTruthy();
    expect(labelled(tree, "Sign in")).toBeFalsy();
    const toSignIn = labelled(tree, "Already have an account? Sign in");
    expect(toSignIn).toBeTruthy();
    toSignIn.props.onPress();
    expect(labelled(render(), "Sign in")).toBeTruthy();
  });

  it("keeps sign-in first for a device that has had a session", async () => {
    state.hadSession = true;
    const tree = await openScreen();
    expect(labelled(tree, "Sign in")).toBeTruthy();
    expect(labelled(tree, "New here? Create an account")).toBeTruthy();
  });
});
