import { expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { MealRecipeDraft } from "@mizyun/contracts";
import { validated } from "./recipe-fixtures.test-support";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  View: "View",
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "Text" }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ border: "#555" }) }));

import { macroText, RecipeDetail } from "./recipe-detail";

function renderedText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(renderedText).join("");
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  return renderedText(
    (node as ReactElement<{ children?: ReactNode }>).props.children,
  );
}

function render(recipe: MealRecipeDraft) {
  return renderedText(
    RecipeDetail({
      recipe,
      portion: 1,
      canAct: true,
      busy: false,
      onPortion: vi.fn(),
      onLog: vi.fn(),
    }),
  );
}

it.each<[number | null, string]>([
  [48.900000000000006, "48.9 g"],
  [49, "49 g"],
  [-2.345, "-2.3 g"],
  [0, "0 g"],
  [-0, "0 g"],
  [-0.01, "0 g"],
  [null, "Unknown"],
  [NaN, "Unknown"],
  [Infinity, "Unknown"],
  [-Infinity, "Unknown"],
])("formats the displayed macro %s as %s", (value, expected) => {
  expect(macroText(value)).toBe(expected);
});

it("renders concise nutrition, ranges, calories and ingredient weights", () => {
  const recipe: MealRecipeDraft = {
    ...validated.recipes[0]!,
    caloriesKcal: 260.90000000000003,
    calorieRangeKcal: { minimum: 250.10000000000002, maximum: 270 },
    nutritionPerServing: {
      proteinG: 48.900000000000006,
      carbohydrateG: 56,
      fatG: null,
    },
    rangesPerServing: {
      proteinG: { minimum: 40.10000000000001, maximum: 49.900000000000006 },
      carbohydrateG: null,
      fatG: null,
    },
    ingredients: [
      {
        ...validated.recipes[0]!.ingredients[0]!,
        weightGrams: 200.10000000000002,
      },
    ],
  };
  const text = render(recipe);
  expect(text).toContain("260.9 kcal");
  expect(text).toContain("P 48.9 g · C 56 g · F Unknown");
  expect(text).toContain("Estimated range: 250.1–270 kcal");
  expect(text).toContain("P 40.1–49.9 g");
  expect(text).toContain("200.1 g");
  expect(text).not.toContain("0000000000");
});

it.each([null, NaN, Infinity])(
  "keeps unknown calorie estimates visible for %s",
  (caloriesKcal) => {
    expect(render({ ...validated.recipes[0]!, caloriesKcal })).toContain(
      "calories unknown",
    );
  },
);
