import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as Array<() => void>,
  request: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (value: any) => (state.slots[state.index++] ??= { current: value }),
  useState: (initial: any) => {
    const i = state.index++;
    if (!(i in state.slots))
      state.slots[i] = typeof initial === "function" ? initial() : initial;
    return [
      state.slots[i],
      (value: any) => {
        state.slots[i] =
          typeof value === "function" ? value(state.slots[i]) : value;
      },
    ];
  },
  useCallback: (callback: any, deps: any[]) => {
    const i = state.index++;
    if (
      !state.slots[i] ||
      !state.slots[i].deps.every((value: any, j: number) =>
        Object.is(value, deps[j]),
      )
    )
      state.slots[i] = { callback, deps };
    return state.slots[i].callback;
  },
  useEffect: (effect: any, deps: any[]) => {
    const i = state.index++;
    if (
      !state.slots[i] ||
      !state.slots[i].deps.every((value: any, j: number) =>
        Object.is(value, deps[j]),
      )
    ) {
      state.slots[i] = { deps };
      state.effects.push(effect);
    }
  },
}));
vi.mock("react-native", () => ({ Pressable: "Pressable", View: "View" }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/constants/theme", () => ({ MinTouchTarget: 44, Spacing: {} }));
vi.mock("@/components/ui", () => ({
  FormField: "FormField",
  FormTextInput: "FormTextInput",
  Icon: "Icon",
}));
vi.mock("./meal-form", () => ({ parseOptionalNutritionNumber: vi.fn() }));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: state.request },
}));
import {
  forgetAdvancedNutritionCapability,
  useAdvancedNutritionCapability,
} from "./advanced-nutrition";

const granted = { ok: true, value: { advancedNutrition: true } };
const denied = { ok: true, value: { advancedNutrition: false } };

function render(owner: string | null = "owner-a", token = "token-a") {
  state.index = 0;
  const hook = useAdvancedNutritionCapability(owner, token);
  const effects = state.effects.splice(0);
  effects.forEach((effect) => effect());
  return hook;
}
/** A fresh screen instance, as when Meals remounts or is refocused. */
function remount(owner: string | null = "owner-a", token = "token-a") {
  state.slots = [];
  return render(owner, token);
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  state.slots = [];
  state.effects = [];
  state.request.mockResolvedValue(granted);
  forgetAdvancedNutritionCapability();
});

it("reuses a recent grant across repeated focus and remounts, then rechecks after expiry", async () => {
  vi.useFakeTimers();
  expect(render().enabled).toBe(false);
  await flush();
  expect(render().enabled).toBe(true);
  expect(state.request).toHaveBeenCalledTimes(1);
  expect(state.request).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "GET",
      path: "/v1/food-entries/capabilities",
      expectedUserId: "owner-a",
    }),
  );
  for (let i = 0; i < 5; i++) {
    expect(await render().revalidate()).toBe(true);
    expect(remount().enabled).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
  }
  expect(state.request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  remount();
  await flush();
  expect(state.request).toHaveBeenCalledTimes(2);
});

it("refresh always reads fresh so pre-save gates see a downgrade", async () => {
  render();
  await flush();
  state.request.mockResolvedValue(denied);
  expect(await render().refresh()).toBe(false);
  expect(render().enabled).toBe(false);
  expect(state.request).toHaveBeenCalledTimes(2);
  // The denial cleared the remembered grant: the next focus asks again.
  expect(await render().revalidate()).toBe(false);
  expect(state.request).toHaveBeenCalledTimes(3);
});

it.each([denied, { ok: false, error: { kind: "network_error" } }, "throw"])(
  "never remembers a denial or failure as a grant (%j)",
  async (outcome) => {
    if (outcome === "throw") state.request.mockRejectedValue(new Error("x"));
    else state.request.mockResolvedValue(outcome);
    render();
    await flush();
    expect(render().enabled).toBe(false);
    remount();
    await flush();
    expect(render().enabled).toBe(false);
    expect(state.request).toHaveBeenCalledTimes(2);
  },
);

it.each(["owner", "token"])(
  "does not reuse a grant after %s change and ignores late answers",
  async (change) => {
    render();
    await flush();
    expect(render().enabled).toBe(true);
    const owner = change === "owner" ? "owner-b" : "owner-a";
    const token = change === "token" ? "token-b" : "token-a";
    let resolveNew!: (value: unknown) => void;
    state.request.mockReturnValueOnce(
      new Promise((done) => {
        resolveNew = done;
      }),
    );
    expect(render(owner, token).enabled).toBe(false);
    expect(state.request).toHaveBeenCalledTimes(2);
    resolveNew(denied);
    await flush();
    expect(render(owner, token).enabled).toBe(false);
  },
);

it("a late answer for the previous account cannot enable the next one", async () => {
  let resolveOld!: (value: unknown) => void;
  state.request
    .mockReturnValueOnce(
      new Promise((done) => {
        resolveOld = done;
      }),
    )
    .mockResolvedValueOnce(denied);
  render("owner-a");
  render("owner-b");
  await flush();
  resolveOld(granted);
  await flush();
  expect(render("owner-b").enabled).toBe(false);
  // Nor was the late grant remembered for the earlier account.
  remount("owner-a");
  expect(state.request).toHaveBeenCalledTimes(3);
});

it("signed-out callers make no request", async () => {
  expect(render(null).enabled).toBe(false);
  expect(await render(null).refresh()).toBe(false);
  expect(state.request).not.toHaveBeenCalled();
});
