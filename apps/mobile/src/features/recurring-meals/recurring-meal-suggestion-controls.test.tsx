import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  focus: null as (() => void | (() => void)) | null,
}));
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  retire: vi.fn(),
  activeOwner: "user-a",
  revisions: {} as Record<string, number>,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (current: unknown) => (hooks.slots[hooks.index++] ??= { current }),
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
  useCallback: (callback: unknown) => callback,
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  Switch: "Switch",
  View: "View",
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    hooks.focus = callback;
  },
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: mocks.request },
}));
vi.mock("./recurring-meal-suggestion-lifetime", () => ({
  isRecurringSuggestionOwnerActive: (owner: string) =>
    owner === mocks.activeOwner,
  recurringSuggestionLifetime: (owner: string) => mocks.revisions[owner] ?? 0,
  retireRecurringMealSuggestions: mocks.retire,
}));
import { RecurringMealSuggestionControls } from "./recurring-meal-suggestion-controls";

function render(owner: string | null = mocks.activeOwner): any {
  hooks.index = 0;
  return RecurringMealSuggestionControls({ userId: owner });
}
function find(node: any, type: string): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node))
    return node.map((child) => find(child, type)).find(Boolean) ?? null;
  return node.type === type ? node : find(node.props?.children, type);
}
function text(node: any): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" ? text(node.props?.children) : "";
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
async function focus(owner = mocks.activeOwner) {
  render(owner);
  const cleanup = hooks.focus?.();
  await settle();
  return cleanup;
}
function deferred() {
  let resolve!: (value: any) => void;
  return {
    promise: new Promise<any>((done) => {
      resolve = done;
    }),
    resolve: (value: any) => resolve(value),
  };
}
const preferences = (enabled: boolean) => ({ ok: true, value: { enabled } });
beforeEach(() => {
  hooks.slots = [];
  hooks.index = 0;
  hooks.focus = null;
  mocks.request.mockReset();
  mocks.retire.mockReset();
  mocks.activeOwner = "user-a";
  mocks.revisions = {};
  mocks.request.mockResolvedValue(preferences(true));
});

describe("recurring meal suggestion controls", () => {
  it("changes only preferences through explicit owner-fenced PATCH; disabling never stops schedules", async () => {
    await focus();
    mocks.request.mockClear();
    find(render(), "Switch").props.onValueChange(false);
    await settle();
    expect(mocks.request).toHaveBeenCalledOnce();
    const request = mocks.request.mock.calls[0][0];
    expect(request).toMatchObject({
      method: "PATCH",
      path: "/v1/recurring-meal-suggestions/preferences",
      body: { enabled: false },
      expectedUserId: "user-a",
    });
    expect(request.isCurrent()).toBe(true);
    expect(find(render(), "Switch").props.value).toBe(false);
    expect(find(render(), "Switch").props.disabled).toBe(false);
    expect(mocks.retire).toHaveBeenCalledWith("user-a");
    expect(
      mocks.request.mock.calls.some(
        ([call]) => call.method === "DELETE" || call.path.includes("/stop"),
      ),
    ).toBe(false);
  });
  it("resets dismissed families through POST reset rather than changing existing schedules", async () => {
    await focus();
    mocks.request.mockClear();
    mocks.request.mockResolvedValue({ ok: true, value: { ok: true } });
    find(render(), "Pressable").props.onPress();
    await settle();
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      method: "POST",
      path: "/v1/recurring-meal-suggestions/reset",
      expectedUserId: "user-a",
    });
    expect(find(render(), "Switch").props.value).toBe(true);
    expect(mocks.retire).toHaveBeenCalledWith("user-a");
  });
  it("drops old-owner settings and pending writes without disabling the next owner's controls", async () => {
    const cleanup = await focus();
    const pending = deferred();
    mocks.request.mockReturnValueOnce(pending.promise);
    find(render(), "Switch").props.onValueChange(false);
    const request = mocks.request.mock.calls.at(-1)![0];
    expect(find(render(), "Switch").props.disabled).toBe(true);
    if (typeof cleanup === "function") cleanup();
    mocks.activeOwner = "user-b";
    expect(render("user-b")).toBeNull();
    expect(request.isCurrent()).toBe(false);
    mocks.request.mockResolvedValue(preferences(true));
    await focus("user-b");
    pending.resolve(preferences(false));
    await settle();
    const next = render("user-b");
    expect(find(next, "Switch").props.value).toBe(true);
    expect(find(next, "Switch").props.disabled).toBe(false);
    expect(mocks.retire).not.toHaveBeenCalled();
  });
  it("ignores mutation results after the same owner's lifetime is retired", async () => {
    await focus();
    const pending = deferred();
    mocks.request.mockReturnValueOnce(pending.promise);
    find(render(), "Switch").props.onValueChange(false);
    const request = mocks.request.mock.calls.at(-1)![0];
    mocks.revisions["user-a"] = 1;
    expect(request.isCurrent()).toBe(false);
    pending.resolve(preferences(false));
    await settle();
    expect(render()).toBeNull();
    expect(mocks.retire).not.toHaveBeenCalled();
    mocks.request.mockResolvedValue(preferences(true));
    await focus();
    expect(find(render(), "Switch").props.value).toBe(true);
    expect(find(render(), "Switch").props.disabled).toBe(false);
  });
  it("does not show controls when preferences are unavailable or there is no active account", async () => {
    mocks.request.mockResolvedValue({
      ok: false,
      error: { kind: "context_changed" },
    });
    await focus();
    expect(render()).toBeNull();
    expect(render(null)).toBeNull();
  });
  it("preserves the saved preference when PATCH fails and permits another attempt", async () => {
    await focus();
    mocks.request.mockResolvedValue({
      ok: false,
      error: { kind: "network_error" },
    });
    find(render(), "Switch").props.onValueChange(false);
    await settle();
    const tree = render();
    expect(find(tree, "Switch").props.value).toBe(true);
    expect(find(tree, "Switch").props.disabled).toBe(false);
    expect(text(tree)).toContain("Could not save suggestions settings");
    expect(mocks.retire).not.toHaveBeenCalled();
  });
});
