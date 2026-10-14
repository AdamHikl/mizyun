import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoodEntry } from "@mizyun/contracts";
const mocks = vi.hoisted(() => ({
  principal: "owner" as string | null,
  data: null as any,
  run: vi.fn(),
  current: true,
  selection: null as any,
  busy: false,
  error: null as string | null,
  focus: null as (() => () => void) | null,
  command: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useCallback: (fn: any) => fn,
  useState: () => [
    mocks.selection,
    (value: any) => {
      mocks.selection = value;
    },
  ],
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (fn: any) => {
    mocks.focus = fn;
  },
}));
vi.mock("@/components/ui", () => ({ Notice: "Notice" }));
vi.mock("./expansions/use-expansion-command", () => ({
  useExpansionCommand: (...args: any[]) => {
    mocks.command(...args);
    return {
      principal: mocks.principal,
      data: mocks.data,
      run: mocks.run,
      busy: mocks.busy,
      error: mocks.error,
      capture: () => () => mocks.current,
    };
  },
}));
vi.mock("./share-meal-modal", () => ({ ShareMealModal: "ShareMealModal" }));
vi.mock("./ui", () => ({
  CommunityButton: "CommunityButton",
  CommunityPage: "CommunityPage",
  CommunityRow: "CommunityRow",
  CommunitySection: "CommunitySection",
  CommunityState: "CommunityState",
}));
import {
  CommunityShareMealScreen,
  selectableSharedMeals,
} from "./share-meal-screen";
const meal = (id: string, userId = "owner", confirmedByUser = true) =>
  ({
    id,
    userId,
    confirmedByUser,
    name: `Meal ${id}`,
    consumedAt: "2026-10-12T12:00:00Z",
  }) as FoodEntry;
function findAll(node: any, type: string): any[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, type));
  return [
    ...(node.type === type ? [node] : []),
    ...findAll(node.props?.children, type),
  ];
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.principal = "owner";
  mocks.data = {
    foodEntries: [
      meal("one"),
      meal("unconfirmed", "owner", false),
      meal("other", "another-owner"),
    ],
  };
  mocks.current = true;
  mocks.selection = null;
  mocks.busy = false;
  mocks.error = null;
});
describe("meal source selection screen", () => {
  it("lists only confirmed meals belonging to the current principal", () => {
    expect(
      selectableSharedMeals(mocks.data.foodEntries, "owner").map(
        (entry) => entry.id,
      ),
    ).toEqual(["one"]);
    const tree = CommunityShareMealScreen();
    expect(findAll(tree, "CommunityRow").map((row) => row.props.title)).toEqual(
      ["Meal one"],
    );
    expect(mocks.command).toHaveBeenCalledWith(
      "/v1/food-entries?limit=200",
      expect.anything(),
      "GET",
    );
    expect(mocks.run).not.toHaveBeenCalled();
    mocks.focus!();
    expect(mocks.run).toHaveBeenCalledWith({});
  });
  it("opens an explicit preview for the selected source and refreshes after publication", () => {
    let tree = CommunityShareMealScreen();
    findAll(tree, "CommunityRow")[0].props.onPress();
    tree = CommunityShareMealScreen();
    const modal = findAll(tree, "ShareMealModal")[0];
    expect(modal.props.mealId).toBe("one");
    expect(modal.props.visible).toBe(true);
    modal.props.onPublished();
    expect(mocks.selection).toBeNull();
    expect(mocks.run).toHaveBeenCalledOnce();
  });
  it("retires a captured selection when its source authority expires", () => {
    findAll(CommunityShareMealScreen(), "CommunityRow")[0].props.onPress();
    mocks.current = false;
    expect(findAll(CommunityShareMealScreen(), "ShareMealModal")).toHaveLength(
      0,
    );
  });
  it("renders no private source rows or modal after principal or data retirement", () => {
    findAll(CommunityShareMealScreen(), "CommunityRow")[0].props.onPress();
    mocks.data = null;
    mocks.principal = null;
    const tree = CommunityShareMealScreen();
    expect(findAll(tree, "CommunityRow")).toHaveLength(0);
    expect(findAll(tree, "ShareMealModal")).toHaveLength(0);
  });
  it("offers saving a confirmed meal when there are no selectable entries", () => {
    mocks.data = { foodEntries: [meal("unconfirmed", "owner", false)] };
    const tree = CommunityShareMealScreen();
    const state = findAll(tree, "CommunityState")[0];
    expect(state.props.title).toBe("No confirmed meals here");
    expect(state.props.action.props.href).toBe("/log-meal");
  });
});
