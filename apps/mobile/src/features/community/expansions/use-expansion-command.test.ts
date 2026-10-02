import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { communityMessagingResponseSchema } from "@mizyun/contracts";
const mocks = vi.hoisted(() => ({
  principal: "owner" as string | null,
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
    session: mocks.principal ? { user: { id: mocks.principal } } : null,
  }),
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: mocks.request },
}));
vi.mock("../state/read-cache", () => ({
  getCommunityReadDeadline: mocks.deadline,
  invalidateCommunityReads: mocks.invalidate,
}));
import { useExpansionCommand } from "./use-expansion-command";
const schema = communityMessagingResponseSchema;
function render() {
  hooks.index = 0;
  return useExpansionCommand("/protected", schema);
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
  vi.clearAllMocks();
  mocks.deadline.mockReturnValue(undefined);
  mocks.request.mockResolvedValue({ ok: true, value: { body: "protected" } });
});
afterEach(() => {
  mocks.cleanup?.();
  vi.useRealTimers();
});
describe("expansion protected-result lifetime", () => {
  it("uses only the remaining original lease when a read is reused", async () => {
    vi.setSystemTime(9_000);
    mocks.deadline.mockReturnValue(10_000);
    await render().run({ operation: "list" });
    expect(render().data).not.toBeNull();
    await vi.advanceTimersByTimeAsync(999);
    expect(render().data).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(render().data).toBeNull();
    expect(mocks.request).toHaveBeenCalledOnce();
  });
  it("refuses an already-expired reused read instead of granting a new lease", async () => {
    vi.setSystemTime(10_000);
    mocks.deadline.mockReturnValue(10_000);
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
    await vi.advanceTimersByTimeAsync(10000);
    expect(render().data).toBeNull();
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it("does not fill from an initial response held beyond the authorization lifetime", async () => {
    const pending = deferred();
    mocks.request.mockReturnValueOnce(pending.promise);
    const request = render().run({ operation: "list" });
    await vi.advanceTimersByTimeAsync(10000);
    pending.resolve({ ok: true, value: { body: "delayed" } });
    expect(await request).toBeNull();
    expect(render().data).toBeNull();
    expect(render().busy).toBe(false);
  });
  it("expires a successful result without replaying its mutation or discovery query", async () => {
    await render().run({ operation: "send", text: "draft" });
    expect(render().data).toEqual({ body: "protected" });
    await vi.advanceTimersByTimeAsync(9999);
    expect(render().data).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(render().data).toBeNull();
    expect(render().error).toMatch(/refresh/i);
    expect(mocks.request).toHaveBeenCalledOnce();
  });
  it("does not extend old data while a refresh remains pending, then accepts only its new result", async () => {
    await render().run({ operation: "list" });
    await vi.advanceTimersByTimeAsync(9000);
    const pending = deferred();
    mocks.request.mockReturnValueOnce(pending.promise);
    const refresh = render().run({ operation: "list" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(render().data).toBeNull();
    expect(render().busy).toBe(true);
    pending.resolve({ ok: true, value: { body: "fresh" } });
    await refresh;
    expect(render().data).toEqual({ body: "fresh" });
    await vi.advanceTimersByTimeAsync(10000);
    expect(render().data).toBeNull();
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it("clears on failed refresh and does not let an earlier expiry clear a later success", async () => {
    await render().run({ operation: "list" });
    await vi.advanceTimersByTimeAsync(9000);
    mocks.request.mockResolvedValueOnce({
      ok: false,
      error: { kind: "network_error" },
    });
    await render().run({ operation: "list" });
    expect(render().data).toBeNull();
    await render().run({ operation: "list" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(render().data).toEqual({ body: "protected" });
    await vi.advanceTimersByTimeAsync(9000);
    expect(render().data).toBeNull();
  });
  it("invalidates an action captured from an expired result", async () => {
    await render().run({ operation: "search" });
    const current = render().capture();
    await vi.advanceTimersByTimeAsync(10000);
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
