import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  change: null as null | ((state: string) => void),
  phase: "idle",
  controller: {
    init: vi.fn(),
    cancel: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    retireAi: vi.fn(),
    getSnapshot: vi.fn(),
  },
  create: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useMemo: (f: () => unknown) => f(),
  useEffect: (f: () => void) => {
    m.effects.push(f);
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, callback: (state: string) => void) => {
      m.change = callback;
      return { remove: m.remove };
    },
  },
}));
vi.mock("./ingredient-review", () => ({
  IngredientReview: "IngredientReview",
}));
vi.mock("./ingredient-review-composition", () => ({
  createRecipeIngredientReviewController: m.create,
}));
import { RecipeIngredientReview } from "./ingredient-review-session";
import { retireIngredientReviews } from "./ingredient-review-lifecycle";
beforeEach(() => {
  vi.clearAllMocks();
  m.effects = [];
  m.phase = "idle";
  m.create.mockReturnValue(m.controller);
  m.controller.getSnapshot.mockImplementation(() => ({ phase: m.phase }));
});
it("initializes review without analysis and disposes on unmount", () => {
  RecipeIngredientReview({
    userId: "host-owner",
    isCurrent: () => true,
    onConfirmed: vi.fn(),
  });
  const dispose = m.effects[0]!();
  expect(m.controller.init).toHaveBeenCalledOnce();
  expect(m.controller.cancel).not.toHaveBeenCalled();
  if (typeof dispose === "function") dispose();
  expect(m.controller.dispose).toHaveBeenCalledOnce();
  expect(m.remove).toHaveBeenCalledOnce();
});
it("background cancels transient work but allows the deliberate system picker activity", () => {
  RecipeIngredientReview({
    userId: "picker-owner",
    isCurrent: () => true,
    onConfirmed: vi.fn(),
  });
  const dispose = m.effects[0]!();
  m.phase = "picking";
  m.change!("background");
  expect(m.controller.cancel).not.toHaveBeenCalled();
  m.phase = "analyzing";
  m.change!("background");
  expect(m.controller.cancel).toHaveBeenCalledOnce();
  if (typeof dispose === "function") dispose();
});
it("registers synchronous consent retirement and unregisters the closed view", async () => {
  RecipeIngredientReview({
    userId: "revocation-host",
    isCurrent: () => true,
    onConfirmed: vi.fn(),
  });
  const dispose = m.effects[0]!();
  await retireIngredientReviews("revocation-host");
  expect(m.controller.retireAi).toHaveBeenCalledOnce();
  if (typeof dispose === "function") dispose();
  await retireIngredientReviews("revocation-host");
  expect(m.controller.retireAi).toHaveBeenCalledOnce();
});

it("suppresses a confirmation callback after unmount or owner retirement", () => {
  const onConfirmed = vi.fn();
  let current = true;
  const tree = RecipeIngredientReview({
    userId: "late-confirm",
    isCurrent: () => current,
    onConfirmed,
  }) as any;
  const dispose = m.effects[0]!();
  const result = { version: "meal-recipe-v1", ingredients: [] };
  current = false;
  tree.props.onConfirmed(result);
  expect(onConfirmed).not.toHaveBeenCalled();
  current = true;
  if (typeof dispose === "function") dispose();
  tree.props.onConfirmed(result);
  expect(onConfirmed).not.toHaveBeenCalled();
});

it("permanently disposes review on account retirement rather than preserving writable manual recovery", async () => {
  RecipeIngredientReview({
    userId: "account-host",
    isCurrent: () => true,
    onConfirmed: vi.fn(),
  });
  const dispose = m.effects[0]!();
  await retireIngredientReviews("account-host", "account");
  expect(m.controller.dispose).toHaveBeenCalledOnce();
  expect(m.controller.retireAi).not.toHaveBeenCalled();
  if (typeof dispose === "function") dispose();
});
