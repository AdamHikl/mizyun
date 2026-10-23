import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  focus: null as any,
  cleanup: null as any,
  focused: true,
  appState: "active",
  app: null as any,
  request: vi.fn(),
  secure: new Map<string, string>(),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => state.secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    state.secure.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    state.secure.delete(key);
  },
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
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (callback: any) => {
    if (state.focus !== callback) {
      state.cleanup?.();
      state.focus = callback;
      state.cleanup = state.focused ? callback() : null;
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
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: state.request },
}));
import { useMealVisualCapability } from "./meal-visual-capability";
import { forgetMealVisualMemory } from "./meal-photo-memory";
import {
  mealVisualsGrantKeyFor,
  resetMealVisualsGrantMemory,
} from "./meal-visuals-offline-grant";

const allowed = { ok: true, value: { mealVisuals: true } };
const denied = { ok: true, value: { mealVisuals: false } };
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function render(owner: string | null = "owner-a", token = "token-a") {
  state.index = 0;
  return useMealVisualCapability(owner, token);
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function blur() {
  state.focused = false;
  state.cleanup?.();
  state.cleanup = null;
}
function focus() {
  state.focused = true;
  state.cleanup = state.focus();
}
function app(next: string) {
  state.appState = next;
  state.app(next);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.slots = [];
  state.index = 0;
  state.focus = state.cleanup = state.app = null;
  state.focused = true;
  state.appState = "active";
  state.request.mockResolvedValue(allowed);
  forgetMealVisualMemory();
  state.secure.clear();
  resetMealVisualsGrantMemory();
});
/** No earlier server confirmation on this device (fresh install). */
function noDeviceConfirmation() {
  state.secure.clear();
  resetMealVisualsGrantMemory();
}
afterEach(() => {
  state.cleanup?.();
  vi.useRealTimers();
});

it("starts closed and binds capability reads to the originating account", async () => {
  expect(render().enabled).toBe(false);
  expect(state.request).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "GET",
      path: "/v1/food-entries/visuals/capability",
      expectedUserId: "owner-a",
    }),
  );
  await flush();
  expect(render().enabled).toBe(true);
});
it("does not request authority without an authenticated owner or while initially backgrounded", async () => {
  expect(render(null).enabled).toBe(false);
  await flush();
  expect(state.request).not.toHaveBeenCalled();
  state.appState = "background";
  expect(render().enabled).toBe(false);
  await flush();
  expect(state.request).not.toHaveBeenCalled();
  app("active");
  await flush();
  expect(render().enabled).toBe(true);
});
it.each([
  denied,
  { ok: false, error: { kind: "network_error" } },
  { ok: true, value: {} },
  { ok: true, value: { mealVisuals: "true" } },
])(
  "fails closed for denial, transport error or malformed authority %j",
  async (response) => {
    state.request.mockResolvedValue(response);
    render();
    await flush();
    expect(render().enabled).toBe(false);
  },
);
it.each(["owner", "token"])(
  "immediately hides old authority and rejects late results after %s change",
  async (change) => {
    const old = deferred();
    state.request
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(denied);
    const oldHook = render();
    const oldOptions = state.request.mock.calls[0]![0];
    const owner = change === "owner" ? "owner-b" : "owner-a";
    const token = change === "token" ? "token-b" : "token-a";
    expect(render(owner, token).enabled).toBe(false);
    expect(oldOptions.signal.aborted).toBe(true);
    expect(oldOptions.isCurrent()).toBe(false);
    await flush();
    old.resolve(allowed);
    await flush();
    expect(render(owner, token).enabled).toBe(false);
    const count = state.request.mock.calls.length;
    expect(await oldHook.refresh()).toBe(false);
    expect(state.request).toHaveBeenCalledTimes(count);
  },
);
it("a fresh denied refresh removes an earlier Pro lease and cannot be overwritten by an older parallel response", async () => {
  render();
  await flush();
  expect(render().enabled).toBe(true);
  const older = deferred();
  state.request
    .mockReturnValueOnce(older.promise)
    .mockResolvedValueOnce(denied);
  const first = render().refresh();
  const olderOptions = state.request.mock.calls[1]![0];
  expect(await render().refresh()).toBe(false);
  expect(olderOptions.signal.aborted).toBe(true);
  older.resolve(allowed);
  expect(await first).toBe(false);
  await flush();
  expect(render().enabled).toBe(false);
});
it("revalidates while focused and retires an expired lease even when the next request never settles", async () => {
  render();
  await flush();
  expect(render().enabled).toBe(true);
  noDeviceConfirmation();
  state.request.mockImplementation(() => new Promise(() => {}));
  await vi.advanceTimersByTimeAsync(20_000);
  expect(state.request).toHaveBeenCalledTimes(2);
  expect(render().enabled).toBe(true);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(render().enabled).toBe(false);
});
it("times out a manual fresh refresh and fails closed without waiting for the transport", async () => {
  render();
  await flush();
  noDeviceConfirmation();
  state.request.mockImplementation(() => new Promise(() => {}));
  const refresh = render().refresh();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await refresh).toBe(false);
  expect(render().enabled).toBe(false);
  expect(state.request.mock.calls[1]![0].signal.aborted).toBe(true);
});
it("cancels background work, prevents late restoration, and revalidates on foreground", async () => {
  const pending = deferred();
  state.request
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(allowed);
  render();
  const options = state.request.mock.calls[0]![0];
  app("background");
  expect(options.signal.aborted).toBe(true);
  pending.resolve(allowed);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(render().enabled).toBe(false);
  expect(state.request).toHaveBeenCalledTimes(1);
  app("active");
  await flush();
  expect(render().enabled).toBe(true);
});
it("retires authority and intervals on blur and checks a downgrade when refocused", async () => {
  render();
  await flush();
  blur();
  expect(render().enabled).toBe(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(state.request).toHaveBeenCalledTimes(1);
  state.request.mockResolvedValue(denied);
  focus();
  await flush();
  expect(render().enabled).toBe(false);
  expect(state.request).toHaveBeenCalledTimes(2);
});
it("reuses a recent same-session confirmation on refocus and still revalidates", async () => {
  render();
  await flush();
  blur();
  expect(render().enabled).toBe(false);
  const pending = deferred();
  state.request.mockReturnValueOnce(pending.promise);
  focus();
  expect(render().enabled).toBe(true);
  expect(state.request).toHaveBeenCalledTimes(2);
  pending.resolve(denied);
  await flush();
  expect(render().enabled).toBe(false);
  blur();
  focus();
  expect(render().enabled).toBe(false);
});
it("does not reuse a confirmation for another token, after expiry or after it is forgotten", async () => {
  render();
  await flush();
  blur();
  state.request.mockReturnValue(new Promise(() => {}));
  focus();
  expect(render("owner-a", "token-b").enabled).toBe(false);
  blur();
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  focus();
  expect(render().enabled).toBe(false);
  state.request.mockResolvedValue(allowed);
  await vi.advanceTimersByTimeAsync(30_000);
  blur();
  forgetMealVisualMemory();
  focus();
  expect(render().enabled).toBe(false);
});

describe("offline grace for bundled icons (ADR-0053 amendment)", () => {
  const offline = { ok: false, error: { kind: "network_error" } };
  const key = mealVisualsGrantKeyFor("owner-a");
  it("keeps icons when the check cannot reach the server after a recent confirmation", async () => {
    render();
    await flush();
    expect(state.secure.get(key)).toBeDefined();
    state.request.mockResolvedValue(offline);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(render().enabled).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(render().enabled).toBe(true);
  });
  it("shows icons on a cold offline launch from the confirmation saved on the device", async () => {
    state.secure.set(key, String(Date.now() - 47 * 60 * 60_000));
    state.request.mockResolvedValue(offline);
    render();
    await flush();
    expect(render().enabled).toBe(true);
  });
  it("treats a check that times out as unreachable", async () => {
    state.secure.set(key, String(Date.now() - 60_000));
    state.request.mockImplementation(() => new Promise(() => {}));
    render();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(render().enabled).toBe(true);
  });
  it.each([
    ["older than 48 hours", String(Date.now() - 48 * 60 * 60_000 - 1)],
    ["in the future", String(Date.now() + 60_000)],
    ["unreadable", "not-a-time"],
  ])("does not use a saved confirmation that is %s", async (_, value) => {
    vi.setSystemTime(Date.now());
    state.secure.set(key, value);
    state.request.mockResolvedValue(offline);
    render();
    await flush();
    expect(render().enabled).toBe(false);
  });
  it("does not use another account's confirmation", async () => {
    state.secure.set(mealVisualsGrantKeyFor("owner-b"), String(Date.now()));
    state.request.mockResolvedValue(offline);
    render();
    await flush();
    expect(render().enabled).toBe(false);
  });
  it("a server denial hides icons now and ends offline display", async () => {
    render();
    await flush();
    state.request.mockResolvedValue(denied);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(render().enabled).toBe(false);
    expect(state.secure.has(key)).toBe(false);
    state.request.mockResolvedValue(offline);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(render().enabled).toBe(false);
  });
  it.each([403, 401])(
    "an HTTP %i also ends offline display",
    async (status) => {
      render();
      await flush();
      state.request.mockResolvedValue({
        ok: false,
        error: { kind: "http_error", status },
      });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(render().enabled).toBe(false);
      expect(state.secure.has(key)).toBe(false);
    },
  );
  it("a server error closes the lease but keeps the confirmation for offline use", async () => {
    render();
    await flush();
    state.request.mockResolvedValue({
      ok: false,
      error: { kind: "http_error", status: 503 },
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(render().enabled).toBe(false);
    expect(state.secure.has(key)).toBe(true);
  });
  it("marks grace display as offline and never reports it as a Pro confirmation", async () => {
    render();
    await flush();
    expect(render().offline).toBe(false);
    state.request.mockResolvedValue(offline);
    expect(await render().refresh()).toBe(false);
    expect(render().enabled).toBe(true);
    expect(render().offline).toBe(true);
  });
  it("treats a sign-in refresh that cannot reach Auth as unreachable", async () => {
    render();
    await flush();
    const retryable = Object.assign(new Error("Network request failed"), {
      name: "AuthRetryableFetchError",
    });
    state.request.mockRejectedValue(
      Object.assign(new Error("Network request failed"), {
        name: "IdentityError",
        cause: retryable,
      }),
    );
    await vi.advanceTimersByTimeAsync(20_000);
    expect(render().enabled).toBe(true);
    // Any other thrown error still fails closed.
    state.request.mockRejectedValue(new Error("synthetic bug"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(render().enabled).toBe(false);
  });
  it("shows icons at once on a cold offline launch instead of after the timeout", async () => {
    state.secure.set(key, String(Date.now() - 60_000));
    state.request.mockImplementation(() => new Promise(() => {}));
    render();
    await flush();
    expect(render().enabled).toBe(true);
    expect(render().offline).toBe(true);
  });
  it("a slow device read never reopens a lease a server answer closed", async () => {
    state.secure.set(key, String(Date.now() - 60_000));
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const secure = await import("expo-secure-store");
    const original = secure.getItemAsync;
    vi.spyOn(secure, "getItemAsync").mockImplementationOnce(async (k) => {
      await gate;
      return original(k);
    });
    state.request.mockResolvedValue({
      ok: false,
      error: { kind: "http_error", status: 503 },
    });
    render();
    await flush();
    release();
    await flush();
    expect(render().enabled).toBe(false);
  });
});
