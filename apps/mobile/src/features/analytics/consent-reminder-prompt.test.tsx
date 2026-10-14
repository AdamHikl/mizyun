import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
  appState: "active",
  listener: null as ((state: string) => void) | null,
  remove: vi.fn(),
  reserve: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.slots)) mocks.slots[index] = initial;
    return [
      mocks.slots[index],
      (next: unknown) => {
        mocks.slots[index] = next;
      },
    ];
  },
  useRef: (initial: unknown) =>
    (mocks.slots[mocks.index++] ??= { current: initial }),
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = mocks.index++;
    const previous = mocks.slots[index];
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
      previous?.cleanup?.();
      const entry = { deps, cleanup: undefined as void | (() => void) };
      mocks.slots[index] = entry;
      mocks.effects.push(() => {
        entry.cleanup = effect();
      });
    }
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return mocks.appState;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocks.listener = listener;
      return { remove: mocks.remove };
    },
  },
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "Text" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "View" }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ textSecondary: "#777" }),
}));
vi.mock("@/constants/theme", () => ({
  Spacing: { two: 8, three: 12, four: 16 },
}));
vi.mock("./consent-reminder-preferences", () => ({
  reserveAnalyticsReminder: mocks.reserve,
  stopAnalyticsReminders: mocks.stop,
}));
import { AnalyticsConsentReminder } from "./consent-reminder-prompt";

type Props = Parameters<typeof AnalyticsConsentReminder>[0];
let props: Props;
function render() {
  mocks.index = 0;
  const tree = AnalyticsConsentReminder(props) as ReactElement<any>;
  mocks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
function button(tree: ReactElement<any>, text: string) {
  return nodes(tree).find(
    (node) =>
      node.type === "Pressable" &&
      nodes(node).some((child) => child.props?.children === text),
  );
}
async function show() {
  render();
  await vi.advanceTimersByTimeAsync(8000);
  return render();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.slots = [];
  mocks.effects = [];
  mocks.index = 0;
  mocks.appState = "active";
  mocks.reserve.mockResolvedValue(true);
  mocks.stop.mockResolvedValue(undefined);
  props = {
    ownerId: "account-a",
    sessionKey: "session-a",
    canPrompt: true,
    readConsent: vi.fn().mockResolvedValue("unknown"),
    openSettings: vi.fn(),
  };
});
afterEach(() => {
  mocks.slots.forEach((slot) => slot?.cleanup?.());
  vi.useRealTimers();
});

describe("analytics consent in-app reminder", () => {
  it("reserves cooldown before showing and opens consent settings without granting", async () => {
    const tree = await show();
    expect(tree.props.visible).toBe(true);
    expect(mocks.reserve).toHaveBeenCalledWith(
      "account-a",
      undefined,
      expect.any(Number),
      expect.any(Function),
    );
    button(tree, "Review analytics").props.onPress();
    expect(props.openSettings).toHaveBeenCalledOnce();
    expect(render().props.visible).toBe(false);
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it.each(["granted", "denied", null] as const)(
    "does not ask when consent is %s",
    async (consent) => {
      vi.mocked(props.readConsent).mockResolvedValue(consent);
      expect((await show()).props.visible).toBe(false);
      expect(mocks.reserve).not.toHaveBeenCalled();
    },
  );

  it("network failure and cooldown/storage failure leave the app uninterrupted", async () => {
    vi.mocked(props.readConsent).mockRejectedValueOnce(new Error("offline"));
    expect((await show()).props.visible).toBe(false);
    props = { ...props, sessionKey: "new-session" };
    mocks.reserve.mockResolvedValue(false);
    expect((await show()).props.visible).toBe(false);
  });

  it.each(["later", "back"])(
    "dismisses through %s without changing consent",
    async (action) => {
      const tree = await show();
      if (action === "later")
        button(tree, "Remind me in 2 weeks").props.onPress();
      else tree.props.onRequestClose();
      expect(render().props.visible).toBe(false);
      expect(props.openSettings).not.toHaveBeenCalled();
      expect(mocks.stop).not.toHaveBeenCalled();
    },
  );

  it("Don't ask again saves suppression, and failed save keeps a retry visible", async () => {
    mocks.stop.mockRejectedValueOnce(new Error("locked"));
    const tree = await show();
    button(tree, "Don’t ask again").props.onPress();
    await vi.advanceTimersByTimeAsync(0);
    let next = render();
    expect(next.props.visible).toBe(true);
    expect(
      nodes(next).some((node) => node.props?.accessibilityRole === "alert"),
    ).toBe(true);
    button(next, "Don’t ask again").props.onPress();
    await vi.advanceTimersByTimeAsync(0);
    next = render();
    expect(next.props.visible).toBe(false);
    expect(mocks.stop).toHaveBeenCalledWith("account-a");
  });

  it("cancels a pending consent read on account switch", async () => {
    let release!: (value: "unknown") => void;
    vi.mocked(props.readConsent).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    render();
    await vi.advanceTimersByTimeAsync(8000);
    props = {
      ...props,
      ownerId: "account-b",
      sessionKey: "session-b",
      canPrompt: false,
    };
    render();
    release("unknown");
    await vi.advanceTimersByTimeAsync(0);
    expect(render().props.visible).toBe(false);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("suppresses background and conflicting flows, then checks on foreground", async () => {
    props = { ...props, canPrompt: false };
    expect((await show()).props.visible).toBe(false);
    props = { ...props, canPrompt: true };
    mocks.listener?.("background");
    expect((await show()).props.visible).toBe(false);
    mocks.listener?.("active");
    expect((await show()).props.visible).toBe(true);
    mocks.listener?.("background");
    expect(render().props.visible).toBe(false);
  });
});
