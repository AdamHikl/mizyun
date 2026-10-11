import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  focus: null as any,
  cleanup: null as any,
  owner: "owner-a",
  token: "token-a",
  appState: "active",
  app: null as any,
  network: null as any,
  capability: vi.fn(),
  ensure: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (value: any) => (state.slots[state.index++] ??= { current: value }),
  useState: (initial: any) => {
    const i = state.index++;
    if (!(i in state.slots)) state.slots[i] = initial;
    return [
      state.slots[i],
      (value: any) => {
        state.slots[i] = value;
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
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (callback: any) => {
    if (state.focus !== callback) {
      state.cleanup?.();
      state.focus = callback;
      state.cleanup = callback();
    }
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return state.appState;
    },
    addEventListener: (_: any, callback: any) => {
      state.app = callback;
      return {
        remove: () => {
          state.app = null;
        },
      };
    },
  },
}));
vi.mock("expo-network", () => ({
  addNetworkStateListener: (callback: any) => {
    state.network = callback;
    return {
      remove: () => {
        state.network = null;
      },
    };
  },
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: {
    getMealIllustrationCapability: state.capability,
    ensureMealIllustration: state.ensure,
  },
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: state.owner }, accessToken: state.token },
  }),
}));
vi.mock("./meal-illustration-tile", () => ({ MealIllustrationTile: "Tile" }));
import { AutomaticMealIllustration } from "./automatic-meal-illustration";

function render(name = "Unusual dinner", allowGeneration = true): any {
  state.index = 0;
  return AutomaticMealIllustration({
    entryId: "meal-a",
    name,
    allowGeneration,
  });
}
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.slots = [];
  state.index = 0;
  state.focus = state.cleanup = state.app = state.network = null;
  state.owner = "owner-a";
  state.token = "token-a";
  state.appState = "active";
  state.capability.mockResolvedValue({ ok: true, value: { available: true } });
  state.ensure.mockResolvedValue({
    ok: true,
    value: {
      status: "ready",
      image: { base64: "ZmFrZQ==", mimeType: "image/jpeg", key: "key" },
    },
  });
});
afterEach(() => {
  state.cleanup?.();
  vi.useRealTimers();
});
it("renders common catalog meals immediately without any network request", async () => {
  expect(render("Oatmeal").props.uri).toBeUndefined();
  await flush();
  expect(state.capability).not.toHaveBeenCalled();
  expect(state.ensure).not.toHaveBeenCalled();
});
it("keeps illustrations immediate while generation is suppressed for real photos", async () => {
  expect(render("Unusual dinner", false).props.uri).toBeUndefined();
  await flush();
  expect(state.ensure).not.toHaveBeenCalled();
});
it("retries an offline unknown dish after reconnection without changing its identity", async () => {
  state.capability.mockResolvedValueOnce({
    ok: false,
    error: { kind: "network_error" },
  });
  render();
  await flush();
  expect(state.ensure).not.toHaveBeenCalled();
  state.network({ isConnected: true, isInternetReachable: true });
  await flush();
  expect(state.ensure).toHaveBeenCalledTimes(1);
  expect(render().props.uri).toBe("data:image/jpeg;base64,ZmFrZQ==");
});
it("rechecks denied consent on focus and cancels observation on blur", async () => {
  state.capability.mockResolvedValueOnce({
    ok: true,
    value: { available: false },
  });
  render();
  await flush();
  expect(state.ensure).not.toHaveBeenCalled();
  state.cleanup?.();
  state.cleanup = state.focus();
  await flush();
  expect(state.ensure).toHaveBeenCalledTimes(1);
  const options = state.ensure.mock.calls[0]![1];
  state.cleanup?.();
  expect(options.signal.aborted).toBe(true);
});
it("drops ready bytes immediately on a token or account change", async () => {
  render();
  await flush();
  expect(render().props.uri).toBeTruthy();
  state.token = "token-b";
  expect(render().props.uri).toBeUndefined();
  state.owner = "owner-b";
  expect(render().props.uri).toBeUndefined();
});
it("cancels pending requests in background and starts fresh on foreground", async () => {
  state.ensure.mockResolvedValue({ ok: true, value: { status: "pending" } });
  render();
  await flush();
  const firstSignal = state.ensure.mock.calls[0]![1].signal;
  state.appState = "background";
  state.app("background");
  expect(firstSignal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(state.ensure).toHaveBeenCalledTimes(1);
  state.appState = "active";
  state.app("active");
  await flush();
  expect(state.ensure).toHaveBeenCalledTimes(2);
});
