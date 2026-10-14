import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => any)[],
  owner: "private-account",
  consent: "granted",
  track: vi.fn(),
  submit: vi.fn(),
  scopes: 0,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const i = state.index++;
    if (!(i in state.slots))
      state.slots[i] = typeof initial === "function" ? initial() : initial;
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
  useMemo: (fn: any) => fn(),
  useCallback: (fn: any) => fn,
  useEffect: (fn: any) => {
    state.effects.push(fn);
  },
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: vi.fn() },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (s: any) => s },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/components/brand-wordmark", () => ({
  BrandWordmark: "BrandWordmark",
}));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  ChoiceChip: "ChoiceChip",
  ChoiceGroup: "ChoiceGroup",
  FormField: "FormField",
  FormTextInput: "FormTextInput",
  Icon: "Icon",
  IconButton: "IconButton",
  ListGroup: "ListGroup",
  ListRow: "ListRow",
  Notice: "Notice",
}));
vi.mock("@/constants/theme", () => ({
  MaxContentWidth: 600,
  PageGutter: 20,
  Spacing: {},
}));
vi.mock("@/composition/api-client", () => ({ apiClient: {} }));
vi.mock("@/features/auth/auth-context", () => ({
  useOptionalAuth: () => ({ session: { user: { id: state.owner } } }),
}));
vi.mock("@/features/beta-pro/beta-pro-client", () => ({
  fetchBetaProStatus: vi.fn(),
  requestBetaProPass: vi.fn(),
}));
vi.mock("@/composition/analytics-client", () => ({
  analyticsClient: {
    createFlowScope: () => ({ flowId: `attempt-${++state.scopes}` }),
    getConsent: async () => state.consent,
    track: state.track,
  },
}));
vi.mock("./submit-onboarding", () => ({ submitOnboarding: state.submit }));
import { OnboardingScreen } from "./onboarding-screen";
import { OnboardingMeasurement } from "./onboarding-measurement";
import { freshOnboardingForm } from "./onboarding-state";
const find = (n: any, predicate: (n: any) => boolean): any =>
  Array.isArray(n)
    ? n.map((x) => find(x, predicate)).find(Boolean)
    : n && typeof n === "object"
      ? predicate(n)
        ? n
        : find(n.props?.children, predicate)
      : null;
const render = (complete = vi.fn(), exit = vi.fn()) => {
  state.index = 0;
  return OnboardingScreen({ onComplete: complete, onExit: exit });
};
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const startEffects = async () => {
  const effects = state.effects.splice(0);
  const cleanups = effects.map((f) => f());
  await settle();
  return cleanups;
};
beforeEach(() => {
  state.slots = [];
  state.index = 0;
  state.effects = [];
  state.owner = "private-account";
  state.consent = "granted";
  state.scopes = 0;
  state.track.mockReset().mockResolvedValue({ recorded: true });
  state.submit.mockReset();
});
describe("onboarding analytics at the actual wizard boundary", () => {
  it("starts after granted consent, survives effect replay and distinguishes explicit exit from cleanup", async () => {
    const exit = vi.fn();
    let tree = render(undefined, exit);
    // React setup/cleanup/setup occurs before its queued consent promise settles.
    const setup = state.effects.shift()!;
    const first = setup();
    first();
    setup();
    await settle();
    expect(state.track.mock.calls.map((c) => c[0].name)).toEqual([
      "onboarding_started",
    ]);
    find(
      tree,
      (n) => n.props?.accessibilityLabel === "Continue",
    ).props.onPress();
    await settle();
    tree = render(undefined, exit);
    find(
      tree,
      (n) => n.props?.accessibilityLabel === "Exit setup",
    ).props.onPress();
    expect(exit).toHaveBeenCalledOnce();
    expect(state.track.mock.calls.map((c) => c[0].name)).toEqual([
      "onboarding_started",
      "onboarding_step_completed",
      "onboarding_exited",
    ]);
    expect(state.track.mock.calls[2][0].properties.step).toBe("display_name");
    expect(new Set(state.track.mock.calls.map((c) => c[1].flowId)).size).toBe(
      1,
    );
    expect(JSON.stringify(state.track.mock.calls)).not.toContain(
      "private-account",
    );
  });
  it("does not create an observed start or exit while consent is off", async () => {
    state.consent = "denied";
    const tree = render();
    await startEffects();
    find(
      tree,
      (n) => n.props?.accessibilityLabel === "Exit setup",
    ).props.onPress();
    expect(state.track).not.toHaveBeenCalled();
  });
  it("records a failed finish, permits recovery, and completes only after persistence succeeds", async () => {
    state.slots[0] = "primaryGoal";
    state.slots[1] = {
      ...freshOnboardingForm(new Date()),
      displayName: "Private name",
      baselineWeight: "70",
      height: "170",
      birthYear: "1990",
      activityLevel: "sedentary",
      sexAtBirth: "female",
      goalKind: "maintain",
      goalWeight: "70",
    };
    const complete = vi.fn();
    let tree = render(complete);
    await startEffects();
    state.submit.mockResolvedValueOnce({
      ok: false,
      message: "Network unavailable",
    });
    find(tree, (n) => n.props?.accessibilityLabel === "Finish").props.onPress();
    await settle();
    expect(complete).not.toHaveBeenCalled();
    expect(state.track.mock.calls.map((c) => c[0].name)).toEqual([
      "onboarding_started",
      "onboarding_failed",
    ]);
    tree = render(complete);
    state.submit.mockResolvedValueOnce({ ok: true });
    find(tree, (n) => n.props?.accessibilityLabel === "Finish").props.onPress();
    await settle();
    expect(complete).toHaveBeenCalledOnce();
    expect(state.track.mock.calls.map((c) => c[0].name)).toEqual([
      "onboarding_started",
      "onboarding_failed",
      "onboarding_step_completed",
      "onboarding_completed",
    ]);
    expect(JSON.stringify(state.track.mock.calls)).not.toMatch(
      /Private name|1990|170|70|Network unavailable/,
    );
  });
  it("deduplicates repeated steps and terminal outcomes; thrown analytics never interrupt setup", () => {
    const scope = { flowId: "attempt" };
    const measurement = new OnboardingMeasurement(
      { track: state.track },
      scope,
      0,
      () => 45_000,
    );
    measurement.stepCompleted("welcome");
    measurement.stepCompleted("welcome");
    measurement.exit("units");
    measurement.complete();
    measurement.fail("units", "network");
    expect(state.track).toHaveBeenCalledTimes(3);
    state.track.mockImplementation(() => {
      throw new Error("offline");
    });
    expect(() =>
      new OnboardingMeasurement({ track: state.track }, scope).complete(),
    ).not.toThrow();
  });
});
