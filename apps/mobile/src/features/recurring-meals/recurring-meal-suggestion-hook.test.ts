import { beforeEach, expect, it, vi } from "vitest";
import { detectRecurringMealSuggestion } from "@mizyun/core";
import { recurringMealSuggestionProposalSchema } from "@mizyun/contracts";
const mocks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
  appState: "active",
  listeners: new Set<() => void>(),
  zone: "UTC",
  requests: [] as any[],
  list: vi.fn(),
  load: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const index = mocks.index++;
    if (!(index in mocks.slots)) mocks.slots[index] = initial;
    return [
      mocks.slots[index],
      (v: any) => {
        mocks.slots[index] =
          typeof v === "function" ? v(mocks.slots[index]) : v;
      },
    ];
  },
  useRef: (initial: any) =>
    (mocks.slots[mocks.index++] ??= { current: initial }),
  useCallback: (fn: any, deps: any[]) => {
    const index = mocks.index++;
    const old = mocks.slots[index];
    if (!old || deps.some((d, i) => d !== old.deps[i]))
      mocks.slots[index] = { deps, fn };
    return mocks.slots[index].fn;
  },
  useEffect: (fn: any, deps?: any[]) => {
    const index = mocks.index++;
    const old = mocks.slots[index];
    if (!deps || !old || deps.some((d, i) => d !== old.deps?.[i])) {
      old?.cleanup?.();
      const item = { deps, cleanup: undefined as any };
      mocks.slots[index] = item;
      mocks.effects.push(() => {
        item.cleanup = fn();
      });
    }
  },
}));
vi.mock("expo-router", async () => {
  const React = await import("react");
  return { useFocusEffect: (fn: () => any) => React.useEffect(fn, [fn]) };
});
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return mocks.appState;
    },
    addEventListener: (_: string, fn: () => void) => {
      mocks.listeners.add(fn);
      return { remove: () => mocks.listeners.delete(fn) };
    },
  },
}));
vi.mock("@/composition/api-client", () => ({
  invalidateSessionReads: vi.fn(),
  apiClient: {
    status: () => ({ configured: true, baseUrl: "https://synthetic.invalid" }),
    request: async (options: any) => {
      mocks.requests.push(options);
      if (options.method === "GET") return mocks.list(options);
      return { ok: true, value: { ok: true } };
    },
  },
}));
vi.mock("@/features/log-meal/public-data", () => ({
  createOperationId: () => "d2440000-0000-4000-8000-000000000097",
}));
vi.mock("./recurring-meal-suggestion-retry", () => ({
  getRecurringSuggestionRetryStore: async () => ({ load: mocks.load }),
}));
vi.mock("./recurring-meal-data", () => ({
  deviceTimeZone: () => mocks.zone,
  loadSchedules: vi.fn(),
  stopSchedule: vi.fn(),
}));
import { useRecurringMealSuggestion } from "./recurring-meal-suggestion-data";
import { setRecurringSuggestionOwner } from "./recurring-meal-suggestion-lifetime";
let owner: string;
let sequence = 90;
const proposal = (zone: string) =>
  recurringMealSuggestionProposalSchema.parse(
    detectRecurringMealSuggestion({
      userId: owner,
      entries: [11, 12, 13].map((day) => ({
        id: `b2440000-0000-4000-8000-${String(day).padStart(12, "0")}`,
        userId: owner,
        name: "Yogurt 150 g",
        confirmedByUser: true,
        consumedAt: `2026-10-${day}T08:00:00Z`,
        createdAt: `2026-10-${day}T08:01:00Z`,
        updatedAt: `2026-10-${day}T08:01:00Z`,
        caloriesKcal: 150,
        proteinG: 12,
        carbohydrateG: 15,
        fatG: 4,
        details: { grams: 150 },
      })),
      generatedEntryIds: [],
      historyComplete: true,
      referenceAt: new Date("2026-10-13T09:00:00Z"),
      timeZone: zone,
    }),
  );
function render() {
  mocks.index = 0;
  const model = useRecurringMealSuggestion(owner, { profileTimeZone: "UTC" });
  mocks.effects.splice(0).forEach((fn) => fn());
  return model;
}
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function appState(state: string) {
  mocks.appState = state;
  for (const fn of mocks.listeners) fn();
}
beforeEach(() => {
  for (const item of mocks.slots) item?.cleanup?.();
  mocks.slots = [];
  mocks.index = 0;
  mocks.effects = [];
  mocks.listeners.clear();
  mocks.requests = [];
  mocks.appState = "active";
  mocks.zone = "UTC";
  mocks.load.mockReset().mockResolvedValue(null);
  mocks.list.mockReset();
  owner = `a2440000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
  setRecurringSuggestionOwner(owner);
  mocks.list.mockImplementation(async (options) => ({
    ok: true,
    value: {
      enabled: true,
      suggestion: proposal(
        new URL(options.path, "https://synthetic.invalid").searchParams.get(
          "timeZone",
        )!,
      ),
    },
  }));
});
it("does not count a background response as viewed and redetects timezone before foreground actions", async () => {
  let resolve!: (v: any) => void;
  mocks.list.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render();
  await settle();
  expect(mocks.requests).toHaveLength(1);
  appState("background");
  let model = render();
  resolve({ ok: true, value: { enabled: true, suggestion: proposal("UTC") } });
  await settle();
  model = render();
  expect(model.candidate).toBeNull();
  await model.accept();
  await model.retry();
  expect(mocks.requests).toHaveLength(1);
  mocks.zone = "America/New_York";
  appState("active");
  expect(render().candidate).toBeNull();
  await settle();
  model = render();
  expect(mocks.requests.filter((r) => r.method === "GET")).toHaveLength(2);
  expect(model.status).toBe("timezone-choice");
  expect(model.candidate).toBeNull();
  expect(mocks.requests.some((r) => r.method === "POST")).toBe(false);
});
it("keeps an older focus response hidden until the latest foreground activation finishes", async () => {
  let initial!: (value: any) => void;
  let freshStorage!: (value: any) => void;
  mocks.load.mockResolvedValueOnce(null).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        freshStorage = resolve;
      }),
  );
  mocks.list
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          initial = resolve;
        }),
    )
    .mockResolvedValueOnce({
      ok: true,
      value: { enabled: true, suggestion: null },
    });
  render();
  await settle();
  appState("background");
  appState("active");
  render();
  initial({ ok: true, value: { enabled: true, suggestion: proposal("UTC") } });
  await settle();
  const model = render();
  expect(freshStorage).toBeTypeOf("function");
  expect(model.candidate).toBeNull();
  expect(mocks.requests).toHaveLength(1);
  await model.accept();
  await model.retry();
  expect(mocks.requests).toHaveLength(1);
  freshStorage(null);
  await settle();
  expect(render().candidate).toBeNull();
  expect(
    mocks.requests.filter((request) => request.method === "GET"),
  ).toHaveLength(2);
  expect(mocks.requests.some((request) => request.method === "POST")).toBe(
    false,
  );
});
it("cannot recreate active authority or dispatch stale mounted callbacks after owner deactivation", async () => {
  render();
  await settle();
  let model = render();
  await settle();
  expect(model.candidate).not.toBeNull();
  const requests = mocks.requests.length;
  setRecurringSuggestionOwner(null);
  await model.accept();
  await model.retry();
  await model.dismiss(false);
  model = render();
  await settle();
  expect(model.candidate).toBeNull();
  await model.accept();
  await model.retry();
  expect(mocks.requests).toHaveLength(requests);
});
