import { describe, expect, it, vi } from "vitest";
import React from "react";
vi.mock("react-native", () => ({
  StyleSheet: { create: (value: unknown) => value },
  Text: "Text",
  View: "View",
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    text: "#000",
    textSecondary: "#555",
    border: "#ccc",
    backgroundElement: "#fff",
    primary: "#080",
  }),
}));
import { SharedWorkoutDetails } from "./shared-workout-details";
function labels(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(labels).join(" ");
  if (
    React.isValidElement<{ children?: unknown; accessibilityLabel?: string }>(
      node,
    )
  )
    return [node.props.accessibilityLabel, labels(node.props.children)]
      .filter(Boolean)
      .join(" ");
  return "";
}
const details = {
  exercises: [
    {
      name: "Squat",
      sets: [
        {
          setType: "warmup" as const,
          repetitions: 8,
          loadKg: 20.5,
          durationSeconds: null,
        },
        {
          setType: "normal" as const,
          repetitions: 0,
          loadKg: 0,
          durationSeconds: 45,
        },
        {
          setType: "drop" as const,
          repetitions: null,
          loadKg: null,
          durationSeconds: null,
        },
      ],
    },
  ],
};
describe("shared workout projection presentation", () => {
  it("shows exact approved measurements and preserves real zero while distinguishing missing values", () => {
    const text = labels(SharedWorkoutDetails({ details }));
    expect(text).toContain("Squat");
    expect(text).toContain("20.5 kg · 8 reps");
    expect(text).toContain("0 kg · 0 reps · 45 sec");
    expect(text).toContain("Warm-up 1");
    expect(text).toContain("No measurements recorded");
    expect(text).not.toContain("null");
  });
  it("keeps feed compact and puts detailed measurements behind the current-access detail view", () => {
    const text = labels(
      SharedWorkoutDetails({ details, compact: true }),
    ).replace(/\s+/g, " ");
    expect(text).toContain("1 exercise · 3 sets");
    expect(text).toContain("Squat");
    expect(text).toContain("View workout details");
    expect(text).not.toContain("20.5 kg");
  });
  it("bounds the exercise-name preview while keeping the full approved detail projection", () => {
    const many = {
      exercises: [
        "Squat",
        "Bench press",
        "Deadlift",
        "Row",
        "Dips",
        "Curl",
      ].map((name) => ({ ...details.exercises[0]!, name })),
    };
    const compact = labels(
      SharedWorkoutDetails({ details: many, compact: true }),
    ).replace(/\s+/g, " ");
    expect(compact).toContain("6 exercises · 18 sets");
    expect(compact).toContain("Squat · Bench press");
    expect(compact).toContain("+4 more");
    expect(compact).not.toContain("Deadlift");
    expect(labels(SharedWorkoutDetails({ details: many }))).toContain(
      "Deadlift",
    );
  });
});
