import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ value: null as any }));
vi.mock("react", () => ({
  useState: () => [
    state.value,
    (value: any) => {
      state.value = value;
    },
  ],
}));
vi.mock("./private-meal-photo", () => ({ PrivateMealPhoto: "Photo" }));
vi.mock("./automatic-meal-illustration", () => ({
  AutomaticMealIllustration: "Illustration",
}));
import { MealVisual } from "./meal-visual";
beforeEach(() => {
  state.value = null;
});
it("starts automatic generation immediately after removing a real photo", () => {
  const props = {
    entryId: "meal-a",
    name: "Unusual dish",
    hasPhoto: true,
    editable: true,
  };
  const before: any = MealVisual(props);
  expect(before.props.fallback.props.allowGeneration).toBe(false);
  before.props.onPhotoRemoved();
  const after: any = MealVisual(props);
  expect(after.props.fallback.props.allowGeneration).toBe(true);
  expect(
    (MealVisual({ ...props, entryId: "meal-b" }) as any).props.fallback.props
      .allowGeneration,
  ).toBe(false);
});
