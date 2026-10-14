import { beforeEach, afterEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
  cleanups: new Map<number, () => void>(),
}));
const mocks = vi.hoisted(() => ({
  session: { user: { id: "owner-a" }, accessToken: "token-a" },
  grant: null as (() => void) | null,
  controllers: [] as any[],
}));
vi.mock("react", async (original) => {
  const memo = (factory: () => any, deps: any[]) => {
    const index = hooks.index++;
    const old = hooks.slots[index];
    if (!old || deps.some((value, i) => !Object.is(value, old.deps[i])))
      hooks.slots[index] = { deps, value: factory() };
    return hooks.slots[index].value;
  };
  return {
    ...(await original<typeof import("react")>()),
    useState: (initial: any) => {
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
    useRef: (current: any) => (hooks.slots[hooks.index++] ??= { current }),
    useMemo: memo,
    useCallback: (fn: any, deps: any[]) => memo(() => fn, deps),
    useEffect: (fn: () => any, deps: any[]) => {
      const index = hooks.index++;
      const old = hooks.slots[index];
      if (!old || deps.some((value, i) => !Object.is(value, old[i]))) {
        hooks.slots[index] = deps;
        hooks.effects.push(() => {
          hooks.cleanups.get(index)?.();
          const cleanup = fn();
          if (cleanup) hooks.cleanups.set(index, cleanup);
        });
      }
    },
  };
});
vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
  KeyboardAvoidingView: "Keyboard",
  Platform: { OS: "ios" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
  TextInput: "TextInput",
  StyleSheet: { create: (v: any) => v },
}));
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  useFocusEffect: vi.fn(),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "Text" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "View" }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: vi.fn() }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: mocks.session }),
}));
vi.mock("./public-data", () => ({
  clearRecipeIngredientData: vi.fn(),
  subscribeRecipeConsentGrant: (_owner: string, callback: () => void) => {
    mocks.grant = callback;
    return vi.fn();
  },
}));
vi.mock("./ingredient-review-lifecycle", () => ({
  registerIngredientReviewRetirement: () => vi.fn(),
}));
vi.mock("./ingredient-review-session", () => ({
  RecipeIngredientReview: "IngredientReview",
}));
vi.mock("@/composition/personal-read-events", () => ({
  subscribeSessionReadUpdates: () => vi.fn(),
}));
vi.mock("./recipe-data", () => ({
  createRecipeController: (owner: string, current: () => boolean) => {
    const controller = {
      owner,
      current,
      init: vi.fn(),
      dispose: vi.fn(),
      refresh: vi.fn(),
      expire: vi.fn(),
      getSnapshot: () => ({ phase: "idle" }),
    };
    mocks.controllers.push(controller);
    return controller;
  },
}));
import { MealRecipesScreen } from "./screen";
const render = () => {
  hooks.index = 0;
  return MealRecipesScreen();
};
const effects = () => {
  for (const effect of hooks.effects.splice(0)) effect();
};
beforeEach(() => {
  vi.useFakeTimers();
  hooks.slots = [];
  hooks.index = 0;
  hooks.effects = [];
  hooks.cleanups = new Map();
  mocks.controllers = [];
  mocks.session = { user: { id: "owner-a" }, accessToken: "token-a" };
  mocks.grant = null;
});
afterEach(() => {
  for (const cleanup of hooks.cleanups.values()) cleanup();
  vi.useRealTimers();
});
it("successful explicit grant synchronously fences old callbacks and remounts the whole recipe flow", () => {
  const initial = render();
  effects();
  const old = mocks.controllers[0];
  expect(old.current()).toBe(true);
  mocks.grant!();
  expect(old.current()).toBe(false);
  const next = render();
  effects();
  expect(next.key).not.toBe(initial.key);
  expect(mocks.controllers).toHaveLength(2);
  expect(old.dispose).toHaveBeenCalledOnce();
  expect(mocks.controllers[1].current()).toBe(true);
});
it.each(["owner", "token"])(
  "late grant after %s replacement cannot remount or revive the originating host",
  (kind) => {
    render();
    effects();
    const old = mocks.controllers[0];
    const grant = mocks.grant!;
    mocks.session =
      kind === "owner"
        ? { user: { id: "owner-b" }, accessToken: "token-b" }
        : { user: { id: "owner-a" }, accessToken: "token-b" };
    render();
    expect(old.current()).toBe(false);
    grant();
    render();
    expect(mocks.controllers).toHaveLength(2);
  },
);
