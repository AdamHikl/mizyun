import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMUNITY_READ_LIFETIME_MS as LIFETIME,
  COMMUNITY_READ_RENEWAL_LEAD_MS as LEAD,
  COMMUNITY_READ_RENEWAL_RETRY_MS as RETRY,
} from "../state/read-cache";
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
vi.mock("../state/read-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/read-cache")>()),
  getCommunityReadDeadline: () => mocks.deadline,
}));
vi.mock("../community-client", () => ({
  fetchSharedActivity: mocks.fetch,
  humanizeCommunityError: () => "Humanized",
  communityErrorCause: (error: any) => {
    while (error.kind === "context_changed" && error.cause) error = error.cause;
    return error;
  },
  isCommunityAccessDenial: (error: any) => {
    while (error.kind === "context_changed" && error.cause) error = error.cause;
    return (
      error.kind === "no_session" ||
      error.kind === "session_expired" ||
      (error.kind === "http_error" && [401, 403, 404].includes(error.status))
    );
  },
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
function texts(node: any): string[] {
  if (typeof node === "string") return [node];
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(texts);
  return texts(node.props?.children);
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
describe("shared workout detail load errors", () => {
  const httpError = (status: number) => ({
    kind: "http_error",
    status,
    code: "NOT_FOUND",
    message: "server",
  });
  it.each([404, 403])(
    "shows the neutral unavailable copy for a retired read wrapping a %i",
    async (status) => {
      mocks.fetch.mockResolvedValueOnce({
        ok: false,
        error: { kind: "context_changed", cause: httpError(status) },
      });
      render();
      await Promise.resolve();
      await Promise.resolve();
      const shown = texts(render());
      expect(shown).toContain("This activity is unavailable.");
      expect(shown).not.toContain("Humanized");
    },
  );
  it("still humanizes a wrapped failure that is not a 403 or 404", async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      error: { kind: "context_changed", cause: httpError(500) },
    });
    render();
    await Promise.resolve();
    await Promise.resolve();
    expect(texts(render())).toContain("Humanized");
  });
});
describe("shared workout detail loading lifetime", () => {
  it("retires protected details and a captured reaction intent at original foreground expiry", async () => {
    // The silent renewal never answers, so the original deadline retires content.
    mocks.fetch.mockReturnValueOnce(
      Promise.resolve({ ok: true, value: activity }),
    );
    mocks.fetch.mockReturnValue(new Promise(() => {}));
    render();
    await Promise.resolve();
    await Promise.resolve();
    const client = find(render(), "ReactionBar").props.scopedClient;
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(find(render(), "ReactionBar")).toBeFalsy();
    expect(await client.request({ method: "POST", path: "/unused" })).toEqual({
      ok: false,
      error: { kind: "context_changed" },
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("renews silently before the deadline so content stays visible past the original deadline", async () => {
    render();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD - 1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    const mid = render();
    expect(find(mid, "ActivityIndicator")).toBeFalsy();
    expect(find(mid, "ReactionBar")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(LEAD + 500);
    const after = render();
    expect(find(after, "ReactionBar")).toBeTruthy();
    expect(texts(after).join(" ")).not.toContain("access is checked again");
    // The renewed deadline is itself bounded and renewed again.
    await vi.advanceTimersByTimeAsync(LIFETIME - 2 * LEAD - 500);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });
  it("retries a transiently failed renewal and keeps content past the original deadline", async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: true, value: activity });
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      error: { kind: "network_error", cause: null },
    });
    render();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(find(render(), "ReactionBar")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(RETRY);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(LEAD + 1);
    expect(Date.now()).toBeGreaterThan(LIFETIME);
    const later = render();
    expect(find(later, "ReactionBar")).toBeTruthy();
    expect(texts(later).join(" ")).not.toContain("access is checked again");
  });
  it("retires content at the original deadline when the renewal fails", async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: true, value: activity });
    mocks.fetch.mockResolvedValue({
      ok: false,
      error: { kind: "network_error", cause: null },
    });
    render();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(LIFETIME - 1);
    expect(find(render(), "ReactionBar")).toBeTruthy();
    // The failed renewal was retried while the content stayed visible.
    expect(mocks.fetch.mock.calls.length).toBeGreaterThan(2);
    await vi.advanceTimersByTimeAsync(1);
    const shown = texts(render());
    expect(find(render(), "ReactionBar")).toBeFalsy();
    expect(shown).toContain(
      "This activity is unavailable until access is checked again.",
    );
  });
  it("retires content immediately when the renewal is denied", async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: true, value: activity });
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "http_error",
        status: 404,
        code: "NOT_FOUND",
        message: "",
      },
    });
    render();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    expect(find(render(), "ReactionBar")).toBeFalsy();
    expect(texts(render())).toContain("This activity is unavailable.");
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
    await vi.advanceTimersByTimeAsync(LIFETIME);
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
vi.mock("../share-bouldering-modal", () => ({
  ShareBoulderingModal: "ShareBoulderingModal",
}));
vi.mock("../shared-bouldering-details", async () => ({
  ...(await import("../bouldering-card-text")),
  SharedBoulderingDetails: "SharedBoulderingDetails",
}));
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
    mocks.fetch.mockResolvedValueOnce({ ok: true, value: meal });
    mocks.fetch.mockReturnValue(new Promise(() => {}));
    render();
    await Promise.resolve();
    await Promise.resolve();
    const client = find(render(), "ReactionBar").props.scopedClient;
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(find(render(), "SharedMealDetails")).toBeFalsy();
    expect(await client.request({ method: "POST", path: "/unused" })).toEqual({
      ok: false,
      error: { kind: "context_changed" },
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe("shared bouldering detail", () => {
  const sessionId = "00000000-0000-4000-8000-0000000000b1";
  const details = {
    activityDate: "2026-10-01",
    topGrade: "6C",
    sends: 9,
    flashes: 4,
    gradeBreakdown: [
      { grade: "6C", sends: 2 },
      { grade: "6B", sends: 7 },
    ],
  };
  const bouldering = {
    ...activity,
    category: "other",
    activityKind: "bouldering",
    boulderingDetails: details,
    workoutDetails: null,
  };
  async function loaded(value: any, principal = "author") {
    mocks.fetch.mockResolvedValue({ ok: true, value });
    render(principal);
    await Promise.resolve();
    await Promise.resolve();
    return render(principal);
  }
  it("renders the allowlisted snapshot and opens the bouldering share sheet for the owner", async () => {
    const tree = await loaded(bouldering);
    expect(tree.props.title).toBe("Shared bouldering session");
    expect(JSON.stringify(tree)).toContain("Bouldering · Top grade 6C");
    expect(find(tree, "SharedBoulderingDetails").props.details).toEqual(
      details,
    );
    expect(find(tree, "SharedWorkoutDetails")).toBeFalsy();
    expect(find(tree, "SharedMealDetails")).toBeFalsy();
    mocks.request.mockResolvedValue({
      ok: true,
      value: {
        ...bouldering,
        sourceWorkoutId: sessionId,
        sourceMealId: null,
        version: 2,
        revokedAt: null,
      },
    });
    await button(tree, "Edit or unpublish shared session").props.onPress();
    await Promise.resolve();
    await Promise.resolve();
    const after = render("author");
    const modal = find(after, "ShareBoulderingModal");
    expect(modal.props.sessionId).toBe(sessionId);
    expect(modal.props.existingActivityId).toBe(activity.id);
    // The strength share path refuses bouldering cards; it must not open.
    expect(find(after, "ShareWorkoutModal")).toBeFalsy();
  });
  it("renders a card without the breakdown and a no-sends card", async () => {
    let tree = await loaded(
      {
        ...bouldering,
        boulderingDetails: { ...details, gradeBreakdown: null },
      },
      "viewer",
    );
    expect(
      find(tree, "SharedBoulderingDetails").props.details.gradeBreakdown,
    ).toBeNull();
    expect(button(tree, "Edit or unpublish shared session")).toBeFalsy();
    hooks.slots = [];
    tree = await loaded(
      {
        ...bouldering,
        boulderingDetails: {
          activityDate: "2026-10-01",
          topGrade: null,
          sends: 0,
          flashes: 0,
          gradeBreakdown: null,
        },
      },
      "viewer",
    );
    expect(JSON.stringify(tree)).toContain("Bouldering · No sends");
  });
  it("keeps the workout presentation for workout cards", async () => {
    const tree = await loaded({ ...activity, activityKind: "workout" });
    expect(tree.props.title).toBe("Shared workout");
    expect(find(tree, "SharedBoulderingDetails")).toBeFalsy();
  });
});
