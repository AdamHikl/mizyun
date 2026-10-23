import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  focus: null as (() => (() => void) | void) | null,
  slots: [] as any[],
  index: 0,
  token: "token-1",
  appState: null as ((state: string) => void) | null,
  loadPreferences: vi.fn(),
  loadHistory: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.slots))
      mocks.slots[index] =
        typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [
      mocks.slots[index],
      (next: unknown) => {
        mocks.slots[index] = next;
      },
    ];
  },
  useCallback: (callback: unknown) => callback,
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: { accessToken: mocks.token } }),
}));
vi.mock("./logging-consistency-preferences", () => ({
  loadLoggingConsistencyPreferences: mocks.loadPreferences,
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, callback: (state: string) => void) => {
      mocks.appState = callback;
      return { remove: vi.fn() };
    },
  },
  Pressable: "Pressable",
  StyleSheet: { create: (value: unknown) => value },
  View: "View",
}));
vi.mock("expo-router", () => ({
  router: { push: mocks.push },
  useFocusEffect: (callback: () => (() => void) | void) => {
    mocks.focus = callback;
  },
}));
vi.mock("expo-secure-store", () => ({}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/ui", () => ({ Card: "Card", Icon: "Icon" }));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    primary: "#0A8F63",
    backgroundSelected: "#E8ECEA",
  }),
}));
vi.mock("./logging-consistency-data", () => ({
  loadLoggingHistory: mocks.loadHistory,
}));

import { computeLoggingConsistency } from "@mizyun/core";
import {
  LoggingConsistencyCard,
  LoggingConsistencyView,
  resolveLoggingConsistencyCard,
} from "./logging-consistency-card";
import { presentLoggingConsistency } from "./logging-consistency-presentation";

function findAll(node: any, predicate: (n: any) => boolean, out: any[] = []) {
  if (Array.isArray(node)) node.forEach((c) => findAll(c, predicate, out));
  else if (node && typeof node === "object") {
    if (predicate(node)) out.push(node);
    findAll(node.props?.children, predicate, out);
  }
  return out;
}
const view = (loggedDates: string[], weeklyGoal = 5) =>
  LoggingConsistencyView({
    presentation: presentLoggingConsistency(
      computeLoggingConsistency({
        loggedDates,
        today: "2026-10-17",
        weeklyGoal,
      })!,
    ),
  });
const texts = (tree: any) =>
  findAll(tree, (n) => n.type === "ThemedText").map((n) => n.props.children);

beforeEach(() => mocks.push.mockReset());

describe("LoggingConsistencyView", () => {
  it("shows weekly progress and seven accessible day dots without actions", () => {
    const tree = view(["2026-10-12", "2026-10-16"]);
    expect(texts(tree)).toContain("Logged 2 of 5 days this week");
    const labelled = findAll(tree, (n) =>
      /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,/.test(
        n.props?.accessibilityLabel ?? "",
      ),
    );
    expect(labelled).toHaveLength(7);
    expect(
      findAll(tree, (n) => n.props?.accessibilityRole === "button"),
    ).toHaveLength(0);
  });

  it("greets a returning user without competing actions or guilt wording", () => {
    const tree = view(["2026-10-10"]);
    expect(texts(tree)).toContain("Welcome back");
    expect(
      findAll(tree, (n) => n.props?.accessibilityRole === "button"),
    ).toHaveLength(0);
  });
});

describe("resolveLoggingConsistencyCard", () => {
  const prefs = { weeklyGoal: 4, hidden: false };
  const history = { today: "2026-10-17", loggedDates: ["2026-10-16"] };

  it("computes the state from preferences and history", async () => {
    const result = await resolveLoggingConsistencyCard("u", {
      loadPreferences: async () => prefs,
      loadHistory: async () => history,
    });
    if (result.kind !== "shown") throw new Error("expected a shown result");
    expect(result.day).toBe("2026-10-17");
    expect(result.value.weeklyGoal).toBe(4);
    expect(result.value.daysLoggedThisWeek).toBe(1);
  });

  it("is hidden when turned off, without reading history", async () => {
    const loadHistory = vi.fn();
    expect(
      await resolveLoggingConsistencyCard("u", {
        loadPreferences: async () => ({ ...prefs, hidden: true }),
        loadHistory,
      }),
    ).toEqual({ kind: "hidden" });
    expect(loadHistory).not.toHaveBeenCalled();
  });

  it("is hidden for an empty history, never 0 of N", async () => {
    expect(
      await resolveLoggingConsistencyCard("u", {
        loadPreferences: async () => prefs,
        loadHistory: async () => ({ today: "2026-10-17", loggedDates: [] }),
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("reports an unreadable history as unknown, not hidden", async () => {
    expect(
      await resolveLoggingConsistencyCard("u", {
        loadPreferences: async () => prefs,
        loadHistory: async () => null,
      }),
    ).toEqual({ kind: "unknown" });
  });
});

describe("LoggingConsistencyCard", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const dayOf = (now: Date) =>
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const ok = () => {
    mocks.loadPreferences.mockResolvedValue({ weeklyGoal: 5, hidden: false });
    mocks.loadHistory.mockImplementation(async () => ({
      today: dayOf(new Date()),
      loggedDates: [dayOf(new Date())],
    }));
  };
  // One mount: fresh hook slots; the focus effect is run like a screen focus.
  const mount = (userId: string) => {
    mocks.slots = [];
    return rerender(userId);
  };
  const rerender = (userId: string) => {
    mocks.index = 0;
    const tree = LoggingConsistencyCard({ userId });
    cleanup?.();
    cleanup = mocks.focus!() as (() => void) | undefined;
    return tree;
  };
  const current = (userId: string) => {
    mocks.index = 0;
    return LoggingConsistencyCard({ userId });
  };
  let cleanup: (() => void) | undefined;

  beforeEach(async () => {
    vi.useRealTimers();
    mocks.loadPreferences.mockReset();
    mocks.loadHistory.mockReset();
    mocks.token = "token-1";
    // Turn the card off so each test starts without a remembered result.
    mocks.loadPreferences.mockResolvedValue({ weeklyGoal: 5, hidden: true });
    mount("reset-user");
    await settle();
    mount("u");
    await settle();
    cleanup?.();
    cleanup = undefined;
    mocks.loadPreferences.mockReset();
    mocks.loadHistory.mockReset();
  });

  it("keeps a shown row when a later history read fails or rejects", async () => {
    ok();
    expect(mount("u")).toBeNull();
    await settle();
    expect(current("u")).not.toBeNull();

    mocks.loadHistory.mockResolvedValue(null);
    mocks.appState!("background");
    mocks.appState!("active");
    await settle();
    expect(current("u")).not.toBeNull();

    mocks.loadHistory.mockRejectedValue(new Error("retired"));
    mocks.token = "token-2";
    rerender("u");
    await settle();
    expect(current("u")).not.toBeNull();
  });

  it("reloads when the app returns to the foreground", async () => {
    ok();
    mount("u");
    await settle();
    expect(mocks.loadHistory).toHaveBeenCalledTimes(1);
    mocks.appState!("active");
    await settle();
    expect(mocks.loadHistory).toHaveBeenCalledTimes(1);
    mocks.appState!("background");
    mocks.appState!("active");
    await settle();
    expect(mocks.loadHistory).toHaveBeenCalledTimes(2);
  });

  it("shows the last result in the first frame of a remount", async () => {
    ok();
    mount("u");
    await settle();
    // Remount with a history read that never resolves.
    mocks.loadHistory.mockReturnValue(new Promise(() => {}));
    expect(mount("u")).not.toBeNull();
  });

  it("does not show it to another user or on the next day", async () => {
    ok();
    mount("u");
    await settle();
    mocks.loadHistory.mockReturnValue(new Promise(() => {}));
    expect(mount("other-user")).toBeNull();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 36 * 60 * 60 * 1000));
    expect(mount("u")).toBeNull();
  });

  it("hides when turned off and a later remount does not resurrect it", async () => {
    ok();
    mount("u");
    await settle();
    expect(current("u")).not.toBeNull();

    mocks.loadPreferences.mockResolvedValue({ weeklyGoal: 5, hidden: true });
    mocks.appState!("background");
    mocks.appState!("active");
    await settle();
    expect(current("u")).toBeNull();

    mocks.loadHistory.mockReturnValue(new Promise(() => {}));
    expect(mount("u")).toBeNull();
  });
});
