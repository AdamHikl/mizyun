import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { communityMessagingResponseSchema } from "@mizyun/contracts";
const mocks = vi.hoisted(() => ({
  principal: "owner" as string | null,
  accessToken: "first-token",
  readEpoch: 0,
  responseEpoch: undefined as number | undefined,
  request: vi.fn(),
  deadline: vi.fn(),
  invalidate: vi.fn(),
  listener: null as null | ((state: string) => void),
  focus: null as any,
  cleanup: null as any,
}));
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
vi.mock("react", () => ({
  useRef: (current: unknown) => {
    const index = hooks.index++;
    return (hooks.slots[index] ??= { current });
  },
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (next: any) => {
        hooks.slots[index] =
          typeof next === "function" ? next(hooks.slots[index]) : next;
      },
    ];
  },
  useCallback: (callback: any, deps: any[]) => {
    const index = hooks.index++;
    const old = hooks.slots[index];
    if (!old || old.deps.some((v: any, i: number) => v !== deps[i]))
      hooks.slots[index] = { deps, value: callback };
    return hooks.slots[index].value;
  },
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (callback: any) => {
    if (mocks.focus !== callback) {
      mocks.cleanup?.();
      mocks.focus = callback;
      mocks.cleanup = callback();
    }
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_: unknown, callback: any) => {
      mocks.listener = callback;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: mocks.principal
      ? { user: { id: mocks.principal }, accessToken: mocks.accessToken }
      : null,
  }),
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: mocks.request },
}));
vi.mock("../state/read-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/read-cache")>()),
  getCommunityReadDeadline: mocks.deadline,
  getCommunityReadEpoch: () => mocks.readEpoch,
  getCommunityResponseEpoch: () => mocks.responseEpoch,
  invalidateCommunityReads: mocks.invalidate,
}));
import {
  COMMUNITY_READ_LIFETIME_MS as LIFETIME,
  COMMUNITY_READ_RENEWAL_LEAD_MS as LEAD,
  COMMUNITY_READ_RENEWAL_RETRY_MS as RETRY,
} from "../state/read-cache";
import { useExpansionCommand } from "./use-expansion-command";
const schema = communityMessagingResponseSchema;
function render() {
  hooks.index = 0;
  return useExpansionCommand("/protected", schema);
}
const readsOnly = (body: Record<string, unknown>) => body.operation === "list";
function renewing(method: "GET" | "POST" = "POST") {
  hooks.index = 0;
  return useExpansionCommand("/protected", schema, method, readsOnly);
}
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((r) => (resolve = r));
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  hooks.slots = [];
  mocks.focus = null;
  mocks.cleanup = null;
  mocks.listener = null;
  mocks.principal = "owner";
  mocks.accessToken = "first-token";
  mocks.readEpoch = 0;
  mocks.responseEpoch = undefined;
  vi.clearAllMocks();
  mocks.deadline.mockReturnValue(undefined);
  mocks.request.mockResolvedValue({ ok: true, value: { body: "protected" } });
});
afterEach(() => {
  mocks.cleanup?.();
  vi.useRealTimers();
});
describe("expansion protected-result lifetime", () => {
  it("silently renews an opted-in read: data stays, no busy or error, new deadline", async () => {
    await renewing().run({ operation: "list" });
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(renewing().busy).toBe(false);
    expect(renewing().data).toEqual({ body: "protected" });
    await vi.advanceTimersByTimeAsync(LEAD);
    expect(renewing().data).toEqual({ body: "protected" });
    expect(renewing().error).toBeNull();
    mocks.request.mockResolvedValue({
      ok: false,
      error: { kind: "network_error" },
    });
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(renewing().data).toBeNull();
  });
  it("renews GET reads without an opt-in predicate", async () => {
    hooks.index = 0;
    await useExpansionCommand("/protected", schema, "GET").run({});
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it("never renews a mutation or discovery query", async () => {
    await renewing().run({ operation: "send", text: "draft" });
    await renewing().run({ operation: "search", prefix: "a" });
    await vi.advanceTimersByTimeAsync(LIFETIME - 1);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(renewing().data).toBeNull();
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it("retires at the original deadline when the renewal hangs", async () => {
    await renewing().run({ operation: "list" });
    mocks.request.mockReturnValue(new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(LIFETIME - 1);
    expect(renewing().data).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(renewing().data).toBeNull();
    expect(renewing().error).toMatch(/refresh/i);
  });
  it("retires at the original deadline when every renewal retry fails", async () => {
    await renewing().run({ operation: "list" });
    mocks.request.mockResolvedValue({
      ok: false,
      error: { kind: "network_error" },
    });
    await vi.advanceTimersByTimeAsync(LIFETIME - 1);
    expect(renewing().data).not.toBeNull();
    // The renewal was retried while the data stayed visible.
    expect(mocks.request.mock.calls.length).toBeGreaterThan(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(renewing().data).toBeNull();
    expect(renewing().error).toMatch(/refresh/i);
  });
  it("a failed renewal keeps the old data until the original deadline", async () => {
    await renewing().run({ operation: "list" });
    mocks.request.mockResolvedValue({
      ok: false,
      error: { kind: "network_error" },
    });
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    expect(renewing().data).not.toBeNull();
    await vi.advanceTimersByTimeAsync(LEAD);
    expect(renewing().data).toBeNull();
  });
  it("retries a transiently failed renewal and keeps data past the original deadline", async () => {
    await renewing().run({ operation: "list" });
    mocks.request.mockResolvedValueOnce({
      ok: false,
      error: { kind: "network_error" },
    });
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(renewing().data).not.toBeNull();
    await vi.advanceTimersByTimeAsync(RETRY);
    expect(mocks.request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(LEAD);
    expect(Date.now()).toBeGreaterThan(LIFETIME);
    expect(renewing().data).toEqual({ body: "protected" });
    expect(renewing().error).toBeNull();
    expect(renewing().authorityDenied).toBe(false);
  });
  it("retires at once, marked denied, when a silent renewal is answered with 403", async () => {
    await renewing().run({ operation: "list" });
    mocks.request.mockResolvedValue({
      ok: false,
      error: {
        kind: "http_error",
        status: 403,
        code: "FORBIDDEN",
        message: "Unavailable",
      },
    });
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(renewing().data).toBeNull();
    expect(renewing().authorityDenied).toBe(true);
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it("keeps a selection captured before a successful silent renewal valid after the original deadline", async () => {
    await renewing().run({ operation: "list" });
    const current = renewing().capture();
    expect(current()).toBe(true);
    await vi.advanceTimersByTimeAsync(LIFETIME - LEAD);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(LEAD + 1);
    expect(Date.now()).toBeGreaterThan(LIFETIME);
    expect(renewing().data).not.toBeNull();
    expect(current()).toBe(true);
    mocks.request.mockResolvedValue({
      ok: false,
      error: { kind: "network_error" },
    });
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(renewing().data).toBeNull();
    expect(current()).toBe(false);
  });
  it("stops renewing on blur", async () => {
    await renewing().run({ operation: "list" });
    mocks.cleanup?.();
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(mocks.request).toHaveBeenCalledOnce();
  });
  it("uses only the remaining original lease when a read is reused", async () => {
    vi.setSystemTime(LIFETIME - 1_000);
    mocks.deadline.mockReturnValue(LIFETIME);
    await render().run({ operation: "list" });
    expect(render().data).not.toBeNull();
    await vi.advanceTimersByTimeAsync(999);
    expect(render().data).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(render().data).toBeNull();
    expect(mocks.request).toHaveBeenCalledOnce();
  });
  it("refuses an already-expired reused read instead of granting a new lease", async () => {
    vi.setSystemTime(LIFETIME);
    mocks.deadline.mockReturnValue(LIFETIME);
    expect(await render().run({ operation: "list" })).toBeNull();
    expect(render().data).toBeNull();
  });
  it("keeps current data and pending actions through unchanged active events", async () => {
    await render().run({ operation: "list" });
    const pending = deferred();
    mocks.request.mockReturnValueOnce(pending.promise);
    const request = render().run({ operation: "send" });
    mocks.listener!("active");
    expect(render().data).toEqual({ body: "protected" });
    pending.resolve({ ok: true, value: { body: "confirmed" } });
    expect(await request).toEqual({ body: "confirmed" });
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(render().data).toBeNull();
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it("does not fill from an initial response held beyond the authorization lifetime", async () => {
    const pending = deferred();
    mocks.request.mockReturnValueOnce(pending.promise);
    const request = render().run({ operation: "list" });
    await vi.advanceTimersByTimeAsync(LIFETIME);
    pending.resolve({ ok: true, value: { body: "delayed" } });
    expect(await request).toBeNull();
    expect(render().data).toBeNull();
    expect(render().busy).toBe(false);
  });
  it("expires a successful result without replaying its mutation or discovery query", async () => {
    await render().run({ operation: "send", text: "draft" });
    expect(render().data).toEqual({ body: "protected" });
    await vi.advanceTimersByTimeAsync(LIFETIME - 1);
    expect(render().data).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(render().data).toBeNull();
    expect(render().error).toMatch(/refresh/i);
    expect(mocks.request).toHaveBeenCalledOnce();
  });
  it("does not extend old data while a refresh remains pending, then accepts only its new result", async () => {
    await render().run({ operation: "list" });
    await vi.advanceTimersByTimeAsync(LIFETIME - 1_000);
    const pending = deferred();
    mocks.request.mockReturnValueOnce(pending.promise);
    const refresh = render().run({ operation: "list" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(render().data).toBeNull();
    expect(render().busy).toBe(true);
    pending.resolve({ ok: true, value: { body: "fresh" } });
    await refresh;
    expect(render().data).toEqual({ body: "fresh" });
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(render().data).toBeNull();
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it("clears on failed refresh and does not let an earlier expiry clear a later success", async () => {
    await render().run({ operation: "list" });
    await vi.advanceTimersByTimeAsync(LIFETIME - 1_000);
    mocks.request.mockResolvedValueOnce({
      ok: false,
      error: { kind: "network_error" },
    });
    await render().run({ operation: "list" });
    expect(render().data).toBeNull();
    await render().run({ operation: "list" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(render().data).toEqual({ body: "protected" });
    await vi.advanceTimersByTimeAsync(LIFETIME - 1_000);
    expect(render().data).toBeNull();
  });
  it("invalidates an action captured from an expired result", async () => {
    await render().run({ operation: "search" });
    const current = render().capture();
    await vi.advanceTimersByTimeAsync(LIFETIME);
    expect(current()).toBe(false);
  });
  it("clears on identity change and rejects old responses", async () => {
    await render().run({ operation: "list" });
    const pending = deferred();
    mocks.request.mockReturnValueOnce(pending.promise);
    const request = render().run({ operation: "list" });
    mocks.principal = "another";
    expect(render().data).toBeNull();
    pending.resolve({ ok: true, value: { body: "old account" } });
    expect(await request).toBeNull();
    expect(render().data).toBeNull();
  });
  it("clears on background/blur and never refills from a late response", async () => {
    await render().run({ operation: "list" });
    const pending = deferred();
    mocks.request.mockReturnValueOnce(pending.promise);
    const request = render().run({ operation: "list" });
    mocks.listener!("background");
    expect(render().data).toBeNull();
    pending.resolve({ ok: true, value: { body: "late" } });
    expect(await request).toBeNull();
    mocks.listener!("active");
    expect(render().data).toBeNull();
    await render().run({ operation: "list" });
    mocks.cleanup();
    expect(render().data).toBeNull();
  });
});

describe("expansion caller authority", () => {
  it("retires data and captured actions on a same-account token change", async () => {
    await render().run({ operation: "latest" });
    const current = render().capture();
    const pending = deferred();
    mocks.request.mockReturnValueOnce(pending.promise);
    const request = render().run({ operation: "send" });
    mocks.accessToken = "refreshed-token";
    expect(render().data).toBeNull();
    expect(current()).toBe(false);
    pending.resolve({ ok: true, value: { body: "old token response" } });
    expect(await request).toBeNull();
    expect(render().data).toBeNull();
  });
  it("retires a completed result immediately when a report write invalidates reads", async () => {
    await render().run({ operation: "latest" });
    expect(render().data).not.toBeNull();
    mocks.readEpoch++;
    expect(render().data).toBeNull();
  });
  it("distinguishes definitive denied authority from uncertain send failures", async () => {
    for (const status of [401, 403, 404]) {
      mocks.request.mockResolvedValueOnce({
        ok: false,
        error: {
          kind: "http_error",
          status,
          code: "NOT_FOUND",
          message: "Unavailable",
        },
      });
      await render().run({ operation: "send" });
      expect(render().authorityDenied).toBe(true);
      expect(render().data).toBeNull();
    }
    for (const error of [
      { kind: "network_error" },
      {
        kind: "http_error",
        status: 503,
        code: "SERVICE_UNAVAILABLE",
        message: "Retry",
      },
    ]) {
      mocks.request.mockResolvedValueOnce({ ok: false, error });
      await render().run({ operation: "send" });
      expect(render().authorityDenied).toBe(false);
    }
  });
  it("keeps wrapped transport denials definitive and local or transient retirement uncertain", async () => {
    for (const status of [401, 403, 404, 503]) {
      mocks.request.mockResolvedValueOnce({
        ok: false,
        error: {
          kind: "context_changed",
          cause: {
            kind: "context_changed",
            cause: {
              kind: "http_error",
              status,
              code: "UNAVAILABLE",
              message: "Unavailable",
            },
          },
        },
      });
      await render().run({ operation: "send" });
      expect(render().authorityDenied).toBe(status !== 503);
      expect(render().data).toBeNull();
    }
    for (const error of [
      { kind: "context_changed" },
      {
        kind: "context_changed",
        cause: { kind: "network_error", cause: "offline" },
      },
    ]) {
      mocks.request.mockResolvedValueOnce({ ok: false, error });
      await render().run({ operation: "send" });
      expect(render().authorityDenied).toBe(false);
      expect(render().error).not.toMatch(/sign in/i);
    }
  });
});
