import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  receipt: vi.fn(),
  deadline: undefined as number | undefined,
  request: vi.fn(),
  appState: null as null | ((state: string) => void),
  cleanup: null as null | (() => void),
  focus: null as null | (() => () => void),
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
    useCallback: (callback: unknown, deps: any[]) => memo(() => callback, deps),
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
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: (styles: unknown) => styles },
  Alert: { alert: vi.fn() },
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, cb: (state: string) => void) => {
      mocks.appState = cb;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("expo-router", async () => {
  const React = await import("react");
  return {
    useRouter: () => ({ back: vi.fn() }),
    useFocusEffect: (cb: () => () => void) => {
      mocks.focus = cb;
      React.useEffect(() => {
        mocks.cleanup = cb();
        return () => mocks.cleanup?.();
      }, [cb]);
    },
  };
});
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: mocks.request },
}));
vi.mock("../state/read-cache", () => ({
  COMMUNITY_READ_LIFETIME_MS: 10000,
  getCommunityReadDeadline: () => mocks.deadline,
}));
vi.mock("../community-client", () => ({
  fetchSharedActivity: mocks.fetch,
  humanizeCommunityError: () => "Unavailable",
  blockUser: vi.fn(),
  setUserMuted: vi.fn(),
}));
vi.mock("../safety/safety-api", () => ({
  captureSafetyReceipt: mocks.receipt,
}));
vi.mock("../reactions", () => ({ ReactionBar: "ReactionBar" }));
vi.mock("../safety", () => ({ ReportModal: "ReportModal" }));
vi.mock("../initials-avatar", () => ({ InitialsAvatar: "InitialsAvatar" }));
vi.mock("../shared-workout-details", () => ({
  SharedWorkoutDetails: "SharedWorkoutDetails",
}));
import { ActivityDetailScreen } from "./activity-detail-screen";
const activity = {
  id: "activity-a",
  authorUserId: "author",
  authorHandle: "friend",
  authorDisplayName: "Friend",
  avatarSymbol: "FR",
  category: "strength",
  sharedDay: "2026-10-01",
  durationSeconds: null,
  publishedAt: "2026-10-01T12:00:00Z",
  reactionCounts: {},
  viewerReaction: null,
};
function render(
  principalKey = "account-a",
  sessionToken = "initial-token",
): any {
  hooks.index = 0;
  const tree = ActivityDetailScreen({
    activityId: "activity-a",
    principalKey,
    sessionToken,
  });
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
function find(node: any, type: string): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node))
    return node.map((child) => find(child, type)).find(Boolean);
  if (node.type === type) return node;
  return find(node.props?.children, type);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  mocks.deadline = undefined;
  hooks.slots = [];
  hooks.effects = [];
  hooks.index = 0;
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue({ ok: true, value: activity });
  mocks.receipt.mockResolvedValue({ ok: true, value: { id: "receipt-a" } });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("shared workout detail loading lifetime", () => {
  it("retires protected details and a captured reaction intent at original foreground expiry", async () => {
    render();
    await Promise.resolve();
    await Promise.resolve();
    const client = find(render(), "ReactionBar").props.scopedClient;
    await vi.advanceTimersByTimeAsync(10000);
    expect(find(render(), "ReactionBar")).toBeFalsy();
    expect(await client.request({ method: "POST", path: "/unused" })).toEqual({
      ok: false,
      error: { kind: "context_changed" },
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("does not extend a restored detail's original authorization deadline", async () => {
    mocks.deadline = 2500;
    render();
    await Promise.resolve();
    await Promise.resolve();
    expect(find(render(), "ReactionBar")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(2500);
    expect(find(render(), "ReactionBar")).toBeFalsy();
  });
  it("finishes loading neutrally when the original request exceeds its lifetime", async () => {
    let finish!: (value: any) => void;
    mocks.fetch.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render();
    await vi.advanceTimersByTimeAsync(10000);
    expect(find(render(), "ActivityIndicator")).toBeFalsy();
    finish({ ok: true, value: activity });
    await Promise.resolve();
    expect(find(render(), "ReactionBar")).toBeFalsy();
  });
  it("rejects a captured same-account action immediately when the session token rotates", async () => {
    render();
    await Promise.resolve();
    await Promise.resolve();
    const client = find(render(), "ReactionBar").props.scopedClient;
    render("account-a", "renewed-token");
    expect(
      find(render("account-a", "renewed-token"), "ReactionBar"),
    ).toBeFalsy();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(await client.request({ method: "POST", path: "/unused" })).toEqual({
      ok: false,
      error: { kind: "context_changed" },
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("keeps the reactions client stable across unrelated receipt rerenders", async () => {
    let finish!: (value: any) => void;
    mocks.receipt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render();
    await Promise.resolve();
    await Promise.resolve();
    const before = find(render(), "ReactionBar").props.scopedClient;
    finish({ ok: true, value: { id: "receipt-a" } });
    await Promise.resolve();
    expect(find(render(), "ReactionBar").props.scopedClient).toBe(before);
  });
  it("does not reload on an unchanged foreground event", async () => {
    render();
    await Promise.resolve();
    await Promise.resolve();
    render();
    mocks.appState!("active");
    await Promise.resolve();
    render();
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it("retires the old reactions client immediately on background and account change", async () => {
    render();
    await Promise.resolve();
    await Promise.resolve();
    const before = find(render(), "ReactionBar").props.scopedClient;
    mocks.appState!("background");
    expect(find(render(), "ReactionBar")).toBeFalsy();
    expect(await before.request({ method: "GET", path: "/unused" })).toEqual({
      ok: false,
      error: { kind: "context_changed" },
    });
    mocks.appState!("active");
    await Promise.resolve();
    await Promise.resolve();
    render("account-b");
    expect(await before.request({ method: "GET", path: "/unused" })).toEqual({
      ok: false,
      error: { kind: "context_changed" },
    });
  });
});

vi.mock("../ui", () => ({
  CommunityPage: "CommunityPage",
  CommunityIdentityLink: "CommunityIdentityLink",
  CommunityButton: "CommunityButton",
}));
vi.mock("../share-workout-modal", () => ({
  ShareWorkoutModal: "ShareWorkoutModal",
}));

vi.mock("../share-meal-modal", () => ({ ShareMealModal: "ShareMealModal" }));
vi.mock("../shared-meal-details", () => ({
  SharedMealDetails: "SharedMealDetails",
}));

function button(node: any, label: string): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node))
    return node.map((child) => button(child, label)).find(Boolean);
  if (node.props?.label === label) return node;
  return button(node.props?.children, label);
}

describe("shared meal detail management", () => {
  const meal = {
    ...activity,
    activityKind: "meal",
    mealDetails: {
      name: "Lentil soup",
      caloriesKcal: null,
      proteinG: null,
      carbsG: null,
      fatG: null,
    },
  };
  it("uses the meal detail view with existing reactions and owner meal controls", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, value: meal });
    render("author");
    await Promise.resolve();
    await Promise.resolve();
    const tree = render("author");
    expect(tree.props.title).toBe("Shared meal");
    expect(find(tree, "SharedMealDetails").props.details).toEqual(
      meal.mealDetails,
    );
    expect(find(tree, "SharedWorkoutDetails")).toBeFalsy();
    expect(find(tree, "ReactionBar")).toBeTruthy();
    const sourceMealId = "00000000-0000-4000-8000-000000000001";
    mocks.request.mockResolvedValue({
      ok: true,
      value: {
        ...meal,
        sourceMealId,
        sourceWorkoutId: null,
        version: 1,
        revokedAt: null,
      },
    });
    await button(tree, "Edit or unpublish shared meal").props.onPress();
    await Promise.resolve();
    await Promise.resolve();
    const modal = find(render("author"), "ShareMealModal");
    expect(modal.props.mealId).toBe(sourceMealId);
    expect(modal.props.existingActivityId).toBe(activity.id);
    expect(find(render("author"), "ShareWorkoutModal")).toBeFalsy();
  });
  it("hides meal projections and rejects reactions after authority expires", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, value: meal });
    render();
    await Promise.resolve();
    await Promise.resolve();
    const client = find(render(), "ReactionBar").props.scopedClient;
    await vi.advanceTimersByTimeAsync(10000);
    expect(find(render(), "SharedMealDetails")).toBeFalsy();
    expect(await client.request({ method: "POST", path: "/unused" })).toEqual({
      ok: false,
      error: { kind: "context_changed" },
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
