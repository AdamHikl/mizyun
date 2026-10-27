import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  SectionHeader: "SectionHeader",
}));
vi.mock("@/constants/theme", () => ({
  Radius: { pill: 999 },
  Spacing: { half: 2, one: 4, two: 8, three: 16 },
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ separator: "#eee", backgroundSelected: "#ddd" }),
}));
vi.mock("@/features/workouts", () => ({
  calculateWorkoutVolume: () => 0,
  formatStopwatch: (seconds: number) => `${seconds}s`,
}));
vi.mock("@/features/share-card", () => ({
  ShareCardButton: "ShareCardButton",
}));

import type { Exercise, Workout, WorkoutSet } from "@mizyun/contracts";
import type { ShareCardContent, ShareCardOptions } from "@mizyun/core";

import { CompletedWorkoutFeed } from "./completed-workout-feed";

const find = (node: any, type: string): any => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, type);
      if (hit) return hit;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  if (node.type === type) return node;
  return find(node.props?.children, type);
};

const workout: Workout = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  name: "SECRET_NAME cut at 84.2 kg",
  startedAt: "2026-10-26T17:00:00.000Z",
  completedAt: "2026-10-26T18:05:00.000Z",
  notes: "SECRET_NOTES bodyweight 84.2 kg, 2100 kcal",
  source: "manual",
  details: { coach: "SECRET_COACH" },
  createdAt: "2026-10-26T17:00:00.000Z",
  updatedAt: "2026-10-26T18:05:00.000Z",
};
const squat = { id: "ex-squat", name: "Back Squat" } as Exercise;
const set = (
  sequence: number,
  loadKg: number,
  setType = "normal",
): WorkoutSet =>
  ({
    id: `set-${sequence}`,
    userId: workout.userId,
    workoutId: workout.id,
    exerciseId: squat.id,
    sequence,
    setType,
    repetitions: 5,
    loadKg,
    durationSeconds: null,
    distanceMeters: null,
    perceivedExertion: 9,
    completedAt: workout.completedAt,
    createdAt: workout.createdAt,
  }) as WorkoutSet;

const render = (props: Partial<Parameters<typeof CompletedWorkoutFeed>[0]>) =>
  CompletedWorkoutFeed({
    workout,
    exercises: [{ id: squat.id, name: squat.name }],
    allExercises: [squat],
    savedSets: [set(1, 60, "warmup"), set(2, 100), set(3, 105)],
    unitSystem: "metric",
    onOpenHistory: () => undefined,
    ...props,
  });

describe("completed workout share card wiring", () => {
  it("offers the card for a signed-in user and builds it without workout name, notes or details", () => {
    const button = find(
      render({ userId: "u1", communityHandle: null }),
      "ShareCardButton",
    );
    expect(button?.props.userId).toBe("u1");
    const card: ShareCardContent = button.props.build({} as ShareCardOptions);
    const text = JSON.stringify(card);
    for (const forbidden of ["SECRET", "84.2", "2100", "kcal", "RPE", "cut"])
      expect(text).not.toContain(forbidden);
    expect(card.rows.map((row) => [row.label, row.value])).toEqual([
      ["Back Squat", "105 kg × 5"],
    ]);
    expect(card.stats.find((stat) => stat.label === "Sets")?.value).toBe("2");
    expect(card.stats.find((stat) => stat.label === "Time")?.value).toBe(
      "1 h 05 min",
    );
  });

  it("uses the local calendar day of completion", () => {
    const button = find(render({ userId: "u1" }), "ShareCardButton");
    const end = new Date(workout.completedAt!);
    const expected = new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(end);
    expect(button.props.build({}).dateLabel).toBe(expected);
  });

  it("is absent without a user or without sets", () => {
    expect(find(render({}), "ShareCardButton")).toBeNull();
    expect(
      find(render({ userId: "u1", savedSets: [] }), "ShareCardButton"),
    ).toBeNull();
  });
});
