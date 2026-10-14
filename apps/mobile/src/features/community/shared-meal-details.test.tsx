import React from "react";
import { describe, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({
  StyleSheet: { create: (value: unknown) => value },
  Text: "Text",
  View: "View",
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ text: "#000", textSecondary: "#555" }),
}));
import { SharedMealDetails } from "./shared-meal-details";

function labels(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(labels).join(" ");
  if (React.isValidElement<{ children?: unknown }>(node))
    return labels(node.props.children);
  return "";
}

const meal = {
  name: "Lentil soup",
  caloriesKcal: null,
  proteinG: null,
  carbsG: null,
  fatG: null,
};

describe("shared meal presentation", () => {
  it("displays the shared name without inventing missing nutrition", () => {
    const text = labels(SharedMealDetails({ details: meal }));
    expect(text).toContain("Lentil soup");
    expect(text).toContain("Nutrition not shared");
    expect(text).not.toContain("kcal");
    expect(text).not.toContain("null");
  });
  it("preserves zero and partial approved measurements with uncertainty", () => {
    const text = labels(
      SharedMealDetails({
        details: { ...meal, caloriesKcal: 320.5, proteinG: 0, carbsG: 40.25 },
      }),
    );
    expect(text).toContain("320.5 kcal · 0 g protein · 40.25 g carbs");
    expect(text).not.toContain("g fat");
    expect(text).toContain("may be estimates");
  });
  it("keeps the feed summary compact", () => {
    const text = labels(SharedMealDetails({ details: meal, compact: true }));
    expect(text).toContain("Nutrition not shared");
    expect(text).not.toContain(meal.name);
  });
});
