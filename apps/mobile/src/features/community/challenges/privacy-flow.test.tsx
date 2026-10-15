import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import type { AuthSession } from "@mizyun/identity";
import { workoutListResponseSchema } from "@mizyun/contracts";
import { SessionReadCache } from "@/composition/session-read-cache";
import {
  CommunityReadCache,
  invalidateCommunityReads,
} from "../state/read-cache";
const mocks = vi.hoisted(() => ({
  data: {} as any,
  run: vi.fn(),
  owner: true,
  joined: false,
  groupId: null as string | null,
  currentAccess: true,
  accessRevision: 0,
  deadline: Number.POSITIVE_INFINITY,
  request: vi.fn(),
  focus: null as null | (() => () => void),
  appState: null as null | ((state: string) => void),
  alert: vi.fn(),
}));
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
let communityReadCache: CommunityReadCache;
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const index = hooks.index++;
    if (!(index in hooks.slots))
      hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], (value: any) => (hooks.slots[index] = value)];
  },
  useCallback: (callback: unknown) => callback,
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    return (hooks.slots[index] ??= { current: initial });
  },
}));
vi.mock("../ui", () => ({ CommunityPage: "CommunityPage" }));
vi.mock("react-native", () => ({
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "ios" },
  Text: "Text",
  View: "View",
  ScrollView: "ScrollView",
  Alert: { alert: mocks.alert },
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, callback: (state: string) => void) => {
      mocks.appState = callback;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: "Screen" },
  useFocusEffect: (callback: () => () => void) => {
    mocks.focus = callback;
  },
  useLocalSearchParams: () => ({ groupId: mocks.groupId ?? undefined }),
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "owner" } } }),
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "black" }) }));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: (options: unknown) => mocks.request(options) },
}));
vi.mock("../community-presentation", () => ({ CommunityIntro: "Intro" }));
vi.mock("../safety/report-modal", () => ({ ReportModal: "Report" }));
vi.mock("../expansions", () => ({
  ExpansionButton: "Button",
  ExpansionInput: "Input",
  useExpansionCommand: () => ({
    data: mocks.data,
    busy: false,
    error: null,
    principal: "owner",
    run: mocks.run,
    capture: () => {
      const revision = mocks.accessRevision;
      const deadline = mocks.deadline;
      return () =>
        mocks.currentAccess &&
        revision === mocks.accessRevision &&
        Date.now() < deadline;
    },
  }),
}));
import { CommunityChallengesScreen } from "./screen";
const challengeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function challenge() {
  return {
    id: challengeId,
    title: mocks.owner ? "My goal" : "Challenge you joined",
    timezone: "UTC",
    joined: mocks.joined,
    isOwner: mocks.owner,
    canceled: false,
    participants: 0,
    teamProgress: null,
    myProgress: 1,
    startDay: "2026-10-10",
    endDay: "2026-10-16",
    goalDays: 4,
    days: [{ day: "2026-10-01", kind: "rest", valid: true }],
  };
}
function render(): any {
  hooks.index = 0;
  const outer = CommunityChallengesScreen();
  return (outer.type as any)(outer.props);
}
function nodes(node: any): any[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
}
function textOutsideText(node: any, insideText = false): (string | number)[] {
  if (Array.isArray(node))
    return node.flatMap((child) => textOutsideText(child, insideText));
  if (typeof node === "string" || typeof node === "number")
    return insideText ? [] : [node];
  if (!node || typeof node !== "object") return [];
  return textOutsideText(
    node.props?.children,
    insideText || node.type === "Text",
  );
}
function button(tree: any, label: string): any {
  return nodes(tree).find(
    (node) => node.type === "Button" && node.props.label === label,
  );
}
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
function confirm() {
  mocks.alert.mock.calls.at(-1)![2][1].onPress();
}
beforeEach(() => {
  mocks.alert.mockClear();
  // Composition registers a store so real invalidation retires navigation epochs.
  communityReadCache = new CommunityReadCache(
    {
      request: (options) => mocks.request(options),
      status: () => ({ configured: false, reason: "synthetic fixture" }),
    } as ApiClient,
    async () => null,
  );
  hooks.slots = [];
  mocks.data = {};
  mocks.owner = true;
  mocks.joined = false;
  mocks.groupId = null;
  mocks.currentAccess = true;
  mocks.accessRevision = 0;
  mocks.deadline = Number.POSITIVE_INFINITY;
  mocks.focus = null;
  mocks.appState = null;
  mocks.request.mockReset();
  vi.clearAllMocks();
  mocks.run.mockImplementation(async (command) => {
    // Model a growth freeze: ordinary reads and engagement remain unavailable.
    if (
      ![
        "listMine",
        "getMine",
        "cancel",
        "leave",
        "removeContribution",
      ].includes(command.operation)
    )
      throw new Error("Growth is paused");
    if (command.operation === "listMine")
      mocks.data = { challenges: [challenge()], nextCursor: challengeId };
    else if (command.operation === "getMine")
      mocks.data = { challenge: challenge() };
    return mocks.data;
  });
});
afterEach(() => {
  communityReadCache.dispose();
  vi.useRealTimers();
});
function renderedText(tree: any): string {
  if (Array.isArray(tree)) return tree.map(renderedText).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return tree?.props ? renderedText(tree.props.children) : "";
}
async function openGroup() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T09:00:00.000Z"));
  mocks.groupId = "fixture-group";
  mocks.joined = true;
  mocks.data = { challenges: [challenge()] };
  mocks.run.mockImplementation(async () => {
    mocks.accessRevision++;
    mocks.deadline = Date.now() + 10_000;
    mocks.data = { challenge: challenge() };
    return mocks.data;
  });
  button(render(), "My goal").props.onPress();
  await settle();
  return render();
}
async function openMine() {
  button(render(), "Manage my challenges").props.onPress();
  await settle();
  button(
    render(),
    mocks.owner ? "My goal" : "Challenge you joined",
  ).props.onPress();
  await settle();
  expect(mocks.run).toHaveBeenCalledWith({
    operation: "getMine",
    id: challengeId,
  });
  return render();
}
const liveWorkouts = {
  workouts: [
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      name: "Live fixture",
      startedAt: "2026-10-10T07:00:00.000Z",
      completedAt: "2026-10-10T07:30:02.732Z",
      notes: null,
      source: "manual",
      details: {},
      createdAt: "2026-10-10T07:00:00.000Z",
      updatedAt: "2026-10-10T07:30:02.732Z",
    },
  ],
};
describe("challenge workout selection", () => {
  it("reads live owner workouts while the display cache holds an empty snapshot", async () => {
    await openGroup();
    const rawRequest = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { workouts: [] } })
      .mockResolvedValue({ ok: true, value: liveWorkouts });
    const cache = new SessionReadCache(
      {
        request: rawRequest,
        status: () => ({ configured: false, reason: "synthetic fixture" }),
      } as ApiClient,
      async () =>
        ({
          user: { id: "owner" },
          accessToken: "synthetic-test-token",
        }) as AuthSession,
      () => Date.now(),
    );
    try {
      const displayRead = {
        method: "GET" as const,
        path: "/v1/workouts?limit=50",
        schema: workoutListResponseSchema,
      };
      expect(await cache.request(displayRead)).toMatchObject({
        ok: true,
        value: { workouts: [] },
      });
      expect(await cache.request(displayRead)).toMatchObject({
        ok: true,
        value: { workouts: [] },
      });
      expect(rawRequest).toHaveBeenCalledTimes(1);
      mocks.request.mockImplementation((options) => cache.request(options));
      button(render(), "Choose a completed workout from today").props.onPress();
      await settle();
      expect(button(render(), "Confirm workout: Live fixture")).toBeDefined();
      expect(rawRequest).toHaveBeenCalledTimes(2);
      expect(rawRequest.mock.calls[1]![0]).toMatchObject({
        expectedUserId: "owner",
        signal: expect.any(AbortSignal),
      });
    } finally {
      cache.clear();
    }
  });
  it.each(["authority", "global invalidation", "background", "blur"])(
    "discards an in-flight workout result after %s retirement",
    async (retirement) => {
      await openGroup();
      // Register the native lifetime callback, then reopen the challenge it resets.
      const leave = mocks.focus!();
      await openGroup();
      let finish!: (value: unknown) => void;
      mocks.request.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      button(render(), "Choose a completed workout from today").props.onPress();
      await settle();
      const signal = mocks.request.mock.calls[0]![0].signal as AbortSignal;
      if (retirement === "authority") mocks.currentAccess = false;
      else if (retirement === "global invalidation") invalidateCommunityReads();
      else if (retirement === "background") mocks.appState!("background");
      else leave();
      finish({ ok: true, value: liveWorkouts });
      await settle();
      expect(button(render(), "Confirm workout: Live fixture")).toBeUndefined();
      if (retirement === "background" || retirement === "blur")
        expect(signal.aborted).toBe(true);
    },
  );
  it("clears prior workout choices on progress refresh and retires an already-rendered confirmation", async () => {
    await openGroup();
    mocks.request.mockResolvedValue({ ok: true, value: liveWorkouts });
    button(render(), "Choose a completed workout from today").props.onPress();
    await settle();
    const tree = render();
    const oldConfirm = button(tree, "Confirm workout: Live fixture");
    expect(oldConfirm).toBeDefined();
    button(tree, "Refresh progress").props.onPress();
    await settle();
    expect(button(render(), "Confirm workout: Live fixture")).toBeUndefined();
    mocks.run.mockClear();
    oldConfirm.props.onPress();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("does not revive prior choices when expired challenge authority is renewed", async () => {
    await openGroup();
    mocks.request.mockResolvedValue({ ok: true, value: liveWorkouts });
    button(render(), "Choose a completed workout from today").props.onPress();
    await settle();
    const oldConfirm = button(render(), "Confirm workout: Live fixture");
    expect(oldConfirm).toBeDefined();
    vi.advanceTimersByTime(10_001);
    expect(button(render(), "Confirm workout: Live fixture")).toBeUndefined();
    mocks.accessRevision++;
    mocks.deadline = Date.now() + 10_000;
    expect(button(render(), "Confirm workout: Live fixture")).toBeUndefined();
    mocks.run.mockClear();
    oldConfirm.props.onPress();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("retires visible choices and old confirmations on global Community invalidation", async () => {
    await openGroup();
    mocks.request.mockResolvedValue({ ok: true, value: liveWorkouts });
    button(render(), "Choose a completed workout from today").props.onPress();
    await settle();
    const oldConfirm = button(render(), "Confirm workout: Live fixture");
    expect(oldConfirm).toBeDefined();
    invalidateCommunityReads();
    expect(button(render(), "Confirm workout: Live fixture")).toBeUndefined();
    mocks.run.mockClear();
    oldConfirm.props.onPress();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
describe("challenge privacy during growth freezes", () => {
  it("shows own declarations without presenting hidden group totals as zero", async () => {
    const text = renderedText(await openMine());
    expect(text).toContain("Your declared days: 1.");
    expect(text).toContain(
      "Open the challenge from its private group to check shared progress and participants.",
    );
    expect(text).not.toContain("0 participants");
    expect(text).not.toContain("Shared declared days:");
  });
  it.each([true, false])(
    "keeps all challenge detail text inside native Text for owner=%s",
    async (owner) => {
      mocks.owner = owner;
      const tree = await openMine();
      expect(textOutsideText(tree)).toEqual([]);
    },
  );
  it("opens owner management without a group link and cancels through the owned read", async () => {
    const tree = await openMine();
    button(tree, "Cancel challenge").props.onPress();
    confirm();
    await settle();
    expect(mocks.run).toHaveBeenCalledWith({
      operation: "cancel",
      id: challengeId,
    });
    expect(mocks.run.mock.calls.at(-1)![0]).toEqual({
      operation: "getMine",
      id: challengeId,
    });
  });
  it("keeps joined-challenge leave and own declaration removal accessible after access is revoked", async () => {
    mocks.owner = false;
    const tree = await openMine();
    expect(button(tree, "Cancel challenge")).toBeUndefined();
    button(tree, "Remove declaration for 2026-10-01").props.onPress();
    confirm();
    await settle();
    expect(mocks.run).toHaveBeenCalledWith({
      operation: "removeContribution",
      id: challengeId,
      day: "2026-10-01",
    });
    button(tree, "Leave and remove my declarations").props.onPress();
    confirm();
    await settle();
    expect(mocks.run).toHaveBeenCalledWith({
      operation: "leave",
      id: challengeId,
    });
    expect(mocks.run.mock.calls.at(-1)![0]).toEqual({
      operation: "getMine",
      id: challengeId,
    });
  });
  it("keeps a failed cancellation visible instead of immediately refreshing over it", async () => {
    const tree = await openMine();
    mocks.run.mockClear();
    mocks.run.mockResolvedValueOnce(null);
    button(tree, "Cancel challenge").props.onPress();
    confirm();
    await settle();
    expect(mocks.run.mock.calls.map(([command]) => command.operation)).toEqual([
      "cancel",
    ]);
  });
  it("paginates own associations with the server cursor during a freeze", async () => {
    button(render(), "Manage my challenges").props.onPress();
    await settle();
    button(render(), "Next page of my challenges").props.onPress();
    await settle();
    expect(mocks.run).toHaveBeenCalledWith({
      operation: "listMine",
      after: challengeId,
    });
  });
});
