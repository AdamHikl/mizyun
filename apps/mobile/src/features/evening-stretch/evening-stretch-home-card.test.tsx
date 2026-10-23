import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  slots: [] as unknown[],
  index: 0,
  focus: null as null | (() => void | (() => void)),
  appState: "unknown",
  today: "2026-10-20",
  listeners: new Set<(next: string) => void>(),
  session: { user: { id: "user-a" }, accessToken: "token-1" } as {
    user: { id: string };
    accessToken: string;
  } | null,
}));
const mocks = vi.hoisted(() => ({
  fetchTodayTraining: vi.fn(),
  loadEveningStretch: vi.fn(),
  refresh: vi.fn(),
  peekTailoredStretchPlan: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.slots)) state.slots[index] = initial;
    return [
      state.slots[index],
      (next: unknown) => {
        state.slots[index] =
          typeof next === "function" ? next(state.slots[index]) : next;
      },
    ];
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return state.appState;
    },
    addEventListener: (_: string, listener: (next: string) => void) => {
      state.listeners.add(listener);
      return { remove: () => state.listeners.delete(listener) };
    },
  },
}));
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  useFocusEffect: (effect: () => void | (() => void)) => {
    state.focus = effect;
  },
}));
vi.mock("@/components/ui", () => ({
  ListGroup: "ListGroup",
  ListRow: "ListRow",
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: state.session }),
}));
vi.mock("./evening-stretch-reminder", () => ({
  EVENING_STRETCH_ROUTE: "/evening-stretch",
  isEveningStretchDoneToday: (settings: { completedDate: string | null }) =>
    settings.completedDate === "today",
  isoLocalDate: () => state.today,
  loadEveningStretch: mocks.loadEveningStretch,
}));
vi.mock("./stretch-ai-refine", () => ({
  peekTailoredStretchPlan: mocks.peekTailoredStretchPlan,
}));
vi.mock("./evening-stretch-runtime", () => ({
  eveningStretchRuntime: { refresh: mocks.refresh },
}));
vi.mock("./today-training-data", () => ({
  fetchTodayTraining: mocks.fetchTodayTraining,
}));

import { buildEveningStretchSession } from "@mizyun/core";

import {
  EveningStretchHomeCard,
  nextStretchSubtitle,
  resetEveningStretchHomeCardMemory,
} from "./evening-stretch-home-card";

const settings = {
  enabled: true,
  hour: 21,
  minute: 0,
  notificationId: null,
  scheduledDate: null,
  scheduledTime: null,
  completedDate: null,
} as unknown as Parameters<typeof nextStretchSubtitle>[1];
const trained = {
  trained: true,
  input: { exercises: [], activities: ["running" as const] },
};
const rest = { trained: false, input: { exercises: [], activities: [] } };

function render(userId = "user-a") {
  state.index = 0;
  return EveningStretchHomeCard({ userId }) as {
    props: { children: { props: { title: string; subtitle: string } } };
  } | null;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  state.slots = [];
  state.focus = null;
  state.appState = "unknown";
  state.today = "2026-10-20";
  state.listeners.clear();
  resetEveningStretchHomeCardMemory();
  state.session = { user: { id: "user-a" }, accessToken: "token-1" };
  mocks.fetchTodayTraining.mockReset();
  mocks.loadEveningStretch.mockReset().mockResolvedValue(settings);
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.peekTailoredStretchPlan.mockReset().mockResolvedValue(null);
});

describe("nextStretchSubtitle", () => {
  it("describes today's cached tailored plan when there is one (ADR-0076)", () => {
    const base = buildEveningStretchSession(trained.input);
    const tailored = { ...base, totalSeconds: base.totalSeconds + 600 };
    const fallback = nextStretchSubtitle(null, settings, trained);
    const withPlan = nextStretchSubtitle(null, settings, trained, tailored);
    expect(withPlan).toContain(
      `about ${Math.round((base.totalSeconds + 600) / 60)} min`,
    );
    expect(withPlan).not.toBe(fallback);
  });

  it("keeps the shown subtitle when the training read fails", () => {
    expect(nextStretchSubtitle("Legs · about 4 min", settings, null)).toBe(
      "Legs · about 4 min",
    );
    expect(nextStretchSubtitle(null, settings, null)).toBeNull();
  });

  it("hides on rest days, when off, or once done", () => {
    expect(nextStretchSubtitle("x", settings, rest)).toBeNull();
    expect(
      nextStretchSubtitle("x", { ...settings, enabled: false }, trained),
    ).toBeNull();
    expect(
      nextStretchSubtitle(
        "x",
        { ...settings, completedDate: "today" } as typeof settings,
        null,
      ),
    ).toBeNull();
  });

  it("describes tonight's plan on training days", () => {
    expect(nextStretchSubtitle(null, settings, trained)).toMatch(/about/);
  });
});

describe("EveningStretchHomeCard", () => {
  it("appears once the app becomes active after a retired launch read", async () => {
    // Launch: the read cache retires reads until the app is active.
    mocks.fetchTodayTraining
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(trained);
    render();
    const cleanup = state.focus!();
    await settle();
    expect(render()).toBeNull();

    state.appState = "active";
    for (const listener of [...state.listeners]) listener("active");
    await settle();

    expect(mocks.fetchTodayTraining).toHaveBeenCalledTimes(2);
    expect(render()?.props.children.props.title).toBe("Tonight's stretch");
    if (typeof cleanup === "function") cleanup();
    expect(state.listeners.size).toBe(0);
  });

  it("reloads when the session token rotates", async () => {
    mocks.fetchTodayTraining
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(trained);
    state.appState = "active";
    render();
    const first = state.focus!;
    first();
    await settle();
    expect(render()).toBeNull();

    state.session = { user: { id: "user-a" }, accessToken: "token-2" };
    render();
    // A new token yields a new focus callback; expo-router re-runs it.
    state.focus!();
    await settle();

    expect(render()?.props.children.props.subtitle).toMatch(/about/);
  });

  it("does not show one account's stretch for another", async () => {
    mocks.fetchTodayTraining.mockResolvedValueOnce(trained);
    state.appState = "active";
    render("user-a");
    state.focus!();
    await settle();
    expect(render("user-a")).not.toBeNull();

    expect(render("user-b")).toBeNull();
    mocks.fetchTodayTraining.mockResolvedValueOnce(null);
    state.focus!();
    await settle();
    expect(render("user-b")).toBeNull();
  });

  it("shows the last subtitle in the first frame when Today mounts again", async () => {
    mocks.fetchTodayTraining.mockResolvedValueOnce(trained);
    state.appState = "active";
    render();
    state.focus!();
    await settle();
    const subtitle = render()?.props.children.props.subtitle;
    expect(subtitle).toMatch(/about/);

    // Leaving Today unmounts the card; the next mount starts with new state.
    state.slots = [];
    mocks.fetchTodayTraining.mockReturnValueOnce(new Promise(() => {}));
    expect(render()?.props.children.props.subtitle).toBe(subtitle);
    state.focus!();
    await settle();
    expect(render()?.props.children.props.subtitle).toBe(subtitle);
  });

  it("does not carry the remembered subtitle to another account or day", async () => {
    mocks.fetchTodayTraining.mockResolvedValueOnce(trained);
    state.appState = "active";
    render();
    state.focus!();
    await settle();
    expect(render()).not.toBeNull();

    state.slots = [];
    expect(render("user-b")).toBeNull();
    state.slots = [];
    state.today = "2026-10-21";
    expect(render()).toBeNull();
  });
});
