import React from "react";
import { describe, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({
  StyleSheet: { create: (value: unknown) => value },
  Text: "Text",
  View: "View",
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ text: "#000", textSecondary: "#555", primary: "#00f" }),
}));
import {
  SharedBoulderingDetails,
  boulderingCardCounts,
  boulderingCardSpoken,
  boulderingCardTitle,
} from "./shared-bouldering-details";
import { activityRowSummary } from "./activity-row-summary";

function labels(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(labels).join(" ");
  if (React.isValidElement<{ children?: unknown }>(node))
    return labels(node.props.children);
  return "";
}

const details = {
  activityDate: "2026-10-16",
  topGrade: "6C" as const,
  sends: 9,
  flashes: 4,
  gradeBreakdown: [
    { grade: "6C" as const, sends: 2 },
    { grade: "6B" as const, sends: 7 },
  ],
};

describe("shared bouldering presentation", () => {
  it("formats title, counts and singular forms", () => {
    expect(boulderingCardTitle(details)).toBe("Bouldering · Top grade 6C");
    expect(boulderingCardCounts(details)).toBe("9 sends · 4 flashes");
    expect(boulderingCardCounts({ ...details, sends: 1, flashes: 1 })).toBe(
      "1 send · 1 flash",
    );
    expect(
      boulderingCardTitle({
        ...details,
        topGrade: null,
        sends: 0,
        flashes: 0,
      }),
    ).toBe("Bouldering · No sends");
    expect(boulderingCardTitle(null)).toBe("Bouldering session");
  });
  it("renders per-grade rows only when the breakdown was shared", () => {
    const tree = SharedBoulderingDetails({ details }) as any;
    expect(labels(tree)).toContain("Sends by grade");
    expect(labels(tree)).toContain("6B");
    expect(tree.props.accessibilityLabel).toBe(boulderingCardSpoken(details));
    const plain = labels(
      SharedBoulderingDetails({
        details: { ...details, gradeBreakdown: null },
      }),
    );
    expect(plain).toContain("9 sends · 4 flashes");
    expect(plain).not.toContain("Sends by grade");
    expect(plain).not.toContain("null");
  });
  it("keeps the feed version compact", () => {
    const text = labels(SharedBoulderingDetails({ details, compact: true }));
    expect(text).not.toContain("Sends by grade");
    expect(text).toContain("6C");
  });
  it("summarises profile timeline rows per kind", () => {
    const base = {
      category: "other" as const,
      sharedDay: "2026-10-16",
      durationSeconds: 1800,
      mealDetails: null,
    };
    expect(
      activityRowSummary({
        ...base,
        activityKind: "bouldering",
        boulderingDetails: details,
      }),
    ).toEqual({
      title: "Bouldering · Top grade 6C",
      description: "2026-10-16 · 9 sends · 4 flashes",
    });
    expect(activityRowSummary({ ...base, activityKind: "workout" })).toEqual({
      title: "other",
      description: "2026-10-16 · 30 min",
    });
    expect(
      activityRowSummary({ ...base, activityKind: "unknown" as never }),
    ).toEqual({ title: "other", description: "2026-10-16 · 30 min" });
  });
});
