import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  UIManager: { setLayoutAnimationEnabledExperimental: vi.fn() },
  LayoutAnimation: {
    configureNext: vi.fn(),
    Presets: { easeInEaseOut: {} },
  },
  Pressable: "Pressable",
  StyleSheet: { create: (s: unknown) => s },
  View: "View",
}));

vi.mock("@/components/themed-text", () => ({
  ThemedText: "ThemedText",
}));

vi.mock("@/constants/theme", () => ({
  Spacing: { one: 4, two: 8, three: 12, four: 16, half: 2 },
}));

import { formatEvidenceSummary, resolveMeta } from "./evidence-chips";

describe("evidence-chips formatEvidenceSummary", () => {
  it("returns empty string when kinds array is empty", () => {
    expect(formatEvidenceSummary([])).toBe("");
  });

  it("formats a single evidence source without additional count", () => {
    expect(formatEvidenceSummary(["profile"])).toBe("Profile & Setup");
    expect(formatEvidenceSummary(["training"])).toBe("Workout History");
  });

  it("formats multiple evidence sources with primary label and +N more count", () => {
    expect(formatEvidenceSummary(["profile", "nutrition"])).toBe(
      "Profile & Setup +1 more",
    );
    expect(
      formatEvidenceSummary([
        "profile",
        "nutrition",
        "energy",
        "plan",
        "training",
        "body",
      ]),
    ).toBe("Profile & Setup +5 more");
  });

  it("deduplicates redundant kinds so count is accurate", () => {
    expect(formatEvidenceSummary(["profile", "profile", "plan"])).toBe(
      "Profile & Setup +1 more",
    );
    expect(formatEvidenceSummary(["plan", "plan"])).toBe("Prescription Engine");
  });

  it("falls back gracefully for unknown evidence kinds", () => {
    const meta = resolveMeta("custom_telemetry");
    expect(meta.label).toBe("Custom_telemetry");
    expect(formatEvidenceSummary(["custom_telemetry"])).toBe(
      "Custom_telemetry",
    );
  });
});
