import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { AuthSession } from "@mizyun/identity";
import type { ApiClient } from "@mizyun/api-client";
import { unpublishActivityResponseSchema as schema } from "@mizyun/contracts";
import { SessionReadCache } from "./session-read-cache";

const state = vi.hoisted(() => ({
  session: null as AuthSession | null,
  profile: null as { birthYear: number } | null,
  cache: null as SessionReadCache | null,
  appState: "active",
  listeners: new Set<(next: string) => void>(),
  authListeners: new Set<(next: AuthSession | null) => void>(),
  networkListeners: new Set<(next: any) => void>(),
  preload: vi.fn(),
  slots: [] as { deps: unknown[]; cleanup?: () => void }[],
  refs: [] as { current: unknown }[],
  index: 0,
  effects: [] as (() => void)[],
}));
vi.mock("react", () => ({
  useRef: (current: unknown) => (state.refs[state.index++] ??= { current }),
  useEffect: (callback: () => (() => void) | void, deps: unknown[]) => {
    const i = state.index++;
    const previous = state.slots[i];
    if (!previous || deps.some((v, j) => !Object.is(v, previous.deps[j]))) {
      state.effects.push(() => {
        previous?.cleanup?.();
        state.slots[i] = { deps, cleanup: callback() || undefined };
      });
    }
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return state.appState;
    },
    addEventListener: (_: string, callback: (next: string) => void) => {
      state.listeners.add(callback);
      return { remove: () => state.listeners.delete(callback) };
    },
  },
}));
vi.mock("expo-network", () => ({
  addNetworkStateListener: (callback: (state: any) => void) => {
    state.networkListeners.add(callback);
    return { remove: () => state.networkListeners.delete(callback) };
  },
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: state.session, profile: state.profile }),
}));
vi.mock("./api-client", () => ({
  apiClient: { request: (options: any) => state.cache!.request(options) },
  apiConfiguration: { configured: true },
  sessionReadCache: {
    clear: () => state.cache!.clear(),
    setForeground: (active: boolean) => state.cache!.setForeground(active),
  },
}));
vi.mock("./auth-client", () => ({
  authClient: {
    subscribe: (callback: (next: AuthSession | null) => void) => {
      state.authListeners.add(callback);
      return () => state.authListeners.delete(callback);
    },
  },
}));
vi.mock("./startup-data", () => ({ preloadAppData: state.preload }));
import { StartupDataBridge } from "./startup-data-bridge";
const alice = {
  user: { id: "alice" },
  accessToken: "synthetic-alice",
} as AuthSession;
const success = { ok: true as const, value: { revoked: false } };
const options = { method: "GET" as const, path: "/v1/workouts", schema };
let request: ReturnType<typeof vi.fn>;
function render() {
  state.index = 0;
  StartupDataBridge();
  state.effects.splice(0).forEach((effect) => effect());
}
function appState(next: string) {
  state.appState = next;
  for (const listener of state.listeners) listener(next);
}
function deferred() {
  let resolve!: (value: typeof success) => void;
  const promise = new Promise<typeof success>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  state.session = alice;
  state.profile = null;
  state.appState = "active";
  state.slots = [];
  state.refs = [];
  state.effects = [];
  state.listeners.clear();
  state.authListeners.clear();
  state.networkListeners.clear();
  state.preload.mockReset().mockResolvedValue(undefined);
  request = vi.fn().mockResolvedValue(success);
  state.cache = new SessionReadCache(
    {
      request,
      status: () => ({ configured: false, reason: "fixture" }),
    } as ApiClient,
    async () => state.session,
  );
});
afterEach(() => {
  state.slots.forEach((slot) => slot?.cleanup?.());
  state.cache!.clear();
});
it("profile hydration warms eligible data without retiring an in-flight tab read", async () => {
  render();
  const pending = deferred();
  request.mockReturnValueOnce(pending.promise);
  const read = state.cache!.request(options);
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  const originalLifetime = state.preload.mock.calls[0]![2];
  state.profile = { birthYear: 1995 };
  render();
  pending.resolve(success);
  expect(await read).toEqual(success);
  expect(originalLifetime()).toBe(true);
  expect(state.preload.mock.calls.at(-1)![4]).toBe(1995);
});
it("a duplicate active event preserves the original warm and pending tab transport", async () => {
  render();
  const pending = deferred();
  request.mockReturnValueOnce(pending.promise);
  const read = state.cache!.request(options);
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  const originalLifetime = state.preload.mock.calls[0]![2];
  appState("active");
  pending.resolve(success);
  expect(await read).toEqual(success);
  expect(originalLifetime()).toBe(true);
});
it("background retires old work, and a tab listener running first on resume can read", async () => {
  let read: Promise<unknown> | undefined;
  state.listeners.add((next) => {
    if (next === "active") read = state.cache!.request(options);
  });
  render();
  const originalLifetime = state.preload.mock.calls[0]![2];
  appState("background");
  expect(originalLifetime()).toBe(false);
  appState("active");
  expect(await read).toEqual(success);
  expect(state.preload.mock.calls.at(-1)![2]()).toBe(true);
});
it("unchanged auth events preserve work but a refreshed token retires it and rewarms", async () => {
  render();
  const originalLifetime = state.preload.mock.calls[0]![2];
  for (const callback of state.authListeners) callback({ ...alice });
  expect(originalLifetime()).toBe(true);
  state.session = { ...alice, accessToken: "synthetic-rotated" };
  for (const callback of state.authListeners) callback(state.session);
  expect(originalLifetime()).toBe(false);
  render();
  expect(state.preload.mock.calls.at(-1)![1]).toEqual(state.session);
  expect(await state.cache!.request(options)).toEqual(success);
});
it("rewarms all tabs on reconnect and ignores duplicate online and background events", () => {
  render();
  const notify = (next: any) => {
    for (const callback of state.networkListeners) callback(next);
  };
  notify({ isConnected: true, isInternetReachable: true });
  expect(state.preload).toHaveBeenCalledTimes(1);
  notify({ isConnected: false });
  notify({ isConnected: true, isInternetReachable: true });
  expect(state.preload).toHaveBeenCalledTimes(2);
  notify({ isConnected: true, isInternetReachable: true });
  expect(state.preload).toHaveBeenCalledTimes(2);
  appState("background");
  notify({ isConnected: false });
  notify({ isConnected: true, isInternetReachable: true });
  expect(state.preload).toHaveBeenCalledTimes(2);
});
