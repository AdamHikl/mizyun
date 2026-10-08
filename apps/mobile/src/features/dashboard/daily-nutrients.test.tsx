import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyFoodSummary } from "@mizyun/contracts";

const state = vi.hoisted(() => ({ expanded: false }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => [
    state.expanded,
    (next: (value: boolean) => boolean) => {
      state.expanded = next(state.expanded);
    },
  ],
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 390, fontScale: 1 }),
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));

import { DailyNutrients } from "./daily-nutrients";

const summary: DailyFoodSummary = {
  date: "2026-10-08",
  entryCount: 3,
  caloriesKcal: 1350,
  proteinG: 60,
  carbohydrateG: 170,
  fatG: 45,
  fibreG: 18,
  saturatedFatG: 12,
  totalSugarsG: 42,
  sodiumMg: 1450,
  cholesterolMg: 0,
};
const props = {
  summary,
  dailyTargetKcal: 2400,
  loading: false,
  hasError: false,
};
function text(node: any): string {
  if (Array.isArray(node))
    return node.map(text).filter(Boolean).join(" ").replace(/\s+/g, " ");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object" ? text(node.props?.children) : "";
}
function toggle(tree: any): any {
  return tree.props.children[0];
}
function nodes(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return node && typeof node === "object"
    ? [node, ...nodes(node.props?.children)]
    : [];
}
beforeEach(() => {
  state.expanded = false;
});

describe("Home more nutrients", () => {
  it("shows a matching bar for every nutrient without inventing limits", () => {
    state.expanded = true;
    const bars = nodes(DailyNutrients(props)).filter((node) =>
      node.props?.testID?.endsWith("-progress"),
    );
    expect(bars.map((node) => node.props.testID)).toEqual([
      "daily-nutrient-fibreG-progress",
      "daily-nutrient-saturatedFatG-progress",
      "daily-nutrient-totalSugarsG-progress",
      "daily-nutrient-sodiumMg-progress",
      "daily-nutrient-cholesterolMg-progress",
    ]);
    const partial = {
      ...summary,
      fibreG: null,
      advancedCoverage: {
        fibreG: 2,
        saturatedFatG: 3,
        totalSugarsG: 3,
        sodiumMg: 3,
        cholesterolMg: 3,
      },
      advancedKnownSubtotal: {
        fibreG: 30,
        saturatedFatG: 12,
        totalSugarsG: 42,
        sodiumMg: 1450,
        cholesterolMg: 0,
      },
    };
    const partialBars = nodes(
      DailyNutrients({ ...props, summary: partial, dailyTargetKcal: null }),
    );
    const fibreBar = partialBars.find(
      (node) => node.props?.testID === "daily-nutrient-fibreG-progress",
    );
    expect(fibreBar.props.children.props.style[1].width).toBe("100%");
    expect(
      partialBars.some(
        (node) =>
          node.props?.testID === "daily-nutrient-saturatedFatG-progress",
      ),
    ).toBe(true);
    expect(
      text(
        DailyNutrients({ ...props, summary: partial, dailyTargetKcal: null }),
      ),
    ).toContain("Meal coverage: 3 of 3 recorded");
    expect(text(DailyNutrients({ ...props, summary: partial }))).toContain(
      "30 g recorded Incomplete · 2 of 3 meals recorded",
    );
  });

  it("uses explicit meal coverage for nutrients without a daily reference", () => {
    state.expanded = true;
    const tree = DailyNutrients({
      ...props,
      summary: {
        ...summary,
        totalSugarsG: null,
        cholesterolMg: null,
        advancedCoverage: {
          fibreG: 3,
          saturatedFatG: 3,
          totalSugarsG: 2,
          sodiumMg: 3,
          cholesterolMg: 0,
        },
        advancedKnownSubtotal: {
          fibreG: 18,
          saturatedFatG: 12,
          totalSugarsG: 28,
          sodiumMg: 1450,
          cholesterolMg: 0,
        },
      },
    });
    const bars = nodes(tree);
    const sugarBar = bars.find(
      (node) => node.props?.testID === "daily-nutrient-totalSugarsG-progress",
    );
    const cholesterolBar = bars.find(
      (node) => node.props?.testID === "daily-nutrient-cholesterolMg-progress",
    );
    expect(
      parseFloat(sugarBar.props.children.props.style[1].width),
    ).toBeCloseTo(200 / 3);
    expect(cholesterolBar.props.children.props.style[1].width).toBe("0%");
    expect(text(tree)).toContain("Meal coverage: 2 of 3 recorded");
    expect(text(tree)).toContain("Dietary cholesterol Not recorded");
    expect(text(tree)).not.toContain("cholesterol 0 mg");
  });

  it("keeps an above-limit value visible while bounding its reference bar", () => {
    state.expanded = true;
    const tree = DailyNutrients({
      ...props,
      summary: { ...summary, sodiumMg: 3000 },
    });
    const bar = nodes(tree).find(
      (node) => node.props?.testID === "daily-nutrient-sodiumMg-progress",
    );
    expect(bar.props.children.props.style[1].width).toBe("100%");
    expect(text(tree)).toContain("3000 mg Reference limit: below 2000 mg");
  });

  it("expands in place, shows saved totals and separates references from personal targets", () => {
    let tree = DailyNutrients(props);
    expect(text(tree)).not.toContain("Fibre");
    expect(toggle(tree).props.accessibilityState).toEqual({ expanded: false });
    toggle(tree).props.onPress();
    tree = DailyNutrients(props);
    expect(toggle(tree).props.accessibilityState).toEqual({ expanded: true });
    expect(text(tree)).toContain("Fibre 18 g Reference goal: at least 25 g");
    expect(text(tree)).toContain(
      "Saturated fat 12 g Reference limit: up to 26.7 g",
    );
    expect(text(tree)).toContain(
      "Sodium 1450 mg Reference limit: below 2000 mg",
    );
    expect(text(tree)).toContain(
      "Dietary cholesterol 0 mg No general daily limit",
    );
    expect(text(tree)).toContain(
      "No total-sugars limit · free sugars are different",
    );
    toggle(tree).props.onPress();
    expect(text(DailyNutrients(props))).not.toContain("Fibre");
  });

  it("labels a partial subtotal and never turns unknown into zero", () => {
    state.expanded = true;
    const partial = {
      ...summary,
      fibreG: null,
      cholesterolMg: null,
      advancedCoverage: {
        fibreG: 2,
        saturatedFatG: 3,
        totalSugarsG: 3,
        sodiumMg: 3,
        cholesterolMg: 0,
      },
      advancedKnownSubtotal: {
        fibreG: 8,
        saturatedFatG: 12,
        totalSugarsG: 42,
        sodiumMg: 1450,
        cholesterolMg: 0,
      },
    };
    const rendered = text(DailyNutrients({ ...props, summary: partial }));
    expect(rendered).toContain(
      "Fibre 8 g recorded Incomplete · 2 of 3 meals recorded",
    );
    expect(rendered).toContain("Dietary cholesterol Not recorded");
    expect(rendered).not.toContain("cholesterol 0 mg");
  });

  it.each([
    { loading: true, hasError: false },
    { loading: false, hasError: true },
  ])(
    "withholds cached Pro totals during revalidation/failure: %s",
    (status) => {
      state.expanded = true;
      const rendered = text(DailyNutrients({ ...props, ...status }));
      expect(rendered).not.toContain("1450 mg");
      expect(rendered).not.toContain("18 g");
    },
  );

  it("removes aggregate values when a fresh downgraded response strips extra fields", () => {
    state.expanded = true;
    expect(text(DailyNutrients(props))).toContain("1450 mg");
    const basic = {
      date: summary.date,
      entryCount: summary.entryCount,
      caloriesKcal: summary.caloriesKcal,
      proteinG: summary.proteinG,
      carbohydrateG: summary.carbohydrateG,
      fatG: summary.fatG,
    };
    const rendered = text(DailyNutrients({ ...props, summary: basic }));
    expect(rendered).toContain("available with Pro");
    expect(rendered).not.toContain("1450 mg");
  });

  it("does not invent a recorded count for older summaries without coverage metadata", () => {
    state.expanded = true;
    const rendered = text(
      DailyNutrients({
        ...props,
        summary: { ...summary, fibreG: null },
      }),
    );
    expect(rendered).toContain(
      "Fibre Not recorded Incomplete · coverage unavailable",
    );
    expect(rendered).not.toContain("0 of 3 meals");
  });

  it("shows empty and unavailable days without fabricated totals", () => {
    state.expanded = true;
    expect(
      text(
        DailyNutrients({ ...props, summary: { ...summary, entryCount: 0 } }),
      ),
    ).toContain("No meals logged today.");
    expect(text(DailyNutrients({ ...props, summary: null }))).toContain(
      "Today’s nutrients are unavailable.",
    );
  });

  it("keeps the saturated-fat reference symbolic when calorie target is missing", () => {
    state.expanded = true;
    const rendered = text(DailyNutrients({ ...props, dailyTargetKcal: null }));
    expect(rendered).toContain("Reference limit: 10% of daily energy");
    expect(rendered).not.toContain("26.7 g");
  });
});
