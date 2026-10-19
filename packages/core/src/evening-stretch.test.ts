import { describe, expect, it } from "vitest";
import { EXERCISE_CATALOG, getExerciseFromCatalog } from "./exercise-catalog";
import {
  GENERAL_STRETCH_IDS,
  STRETCH_HOLD_SECONDS,
  buildEveningStretchSession,
  formatStretchFocus,
  type StretchSessionInput,
  resolveStretchSourceExercise,
} from "./evening-stretch";

const ex = (name: string, setCount: number, catalogId?: string) => ({
  name,
  setCount,
  ...(catalogId ? { catalogId } : {}),
});

const stretchOf = (id: string) => {
  const found = getExerciseFromCatalog(id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};

const legDay: StretchSessionInput = {
  exercises: [
    ex("Barbell Back Squat", 4),
    ex("Banded Romanian Deadlift", 3, "exercise-banded-romanian-deadlift"),
  ],
  activities: [],
};

const targets = (plan: ReturnType<typeof buildEveningStretchSession>) =>
  new Set(plan.steps.flatMap((step) => step.targetMuscles));

describe("general set", () => {
  it("uses real bodyweight stretching catalog entries", () => {
    expect(GENERAL_STRETCH_IDS).toHaveLength(6);
    for (const id of GENERAL_STRETCH_IDS) {
      const entry = stretchOf(id);
      expect(entry.category).toBe("stretching");
      expect(entry.equipment).toEqual(["bodyweight"]);
    }
  });
});

describe("buildEveningStretchSession", () => {
  it("targets the legs after a leg day", () => {
    const plan = buildEveningStretchSession(legDay);
    expect(plan.basis).toBe("today");
    expect(plan.focusMuscles.length).toBeLessThanOrEqual(4);
    expect(plan.focusMuscles).toEqual(
      expect.arrayContaining(["quadriceps", "glutes", "hamstrings"]),
    );
    const covered = targets(plan);
    for (const muscle of ["quadriceps", "glutes", "hamstrings"]) {
      expect(covered.has(muscle)).toBe(true);
    }
    const first = plan.steps[0]!;
    expect(first.targetMuscles.some((m) => plan.focusMuscles.includes(m))).toBe(
      true,
    );
    expect(first.targetMuscles).not.toContain("chest");
    expect(first.targetMuscles).not.toContain("triceps");
  });

  it("targets chest and triceps after a push day", () => {
    const plan = buildEveningStretchSession({
      exercises: [
        ex("Barbell Bench Press", 4, "barbell-bench-press"),
        ex("Close-Grip Bench Press", 3, "exercise-close-grip-bench-press"),
      ],
      activities: [],
    });
    expect(plan.focusMuscles).toContain("chest");
    expect(plan.focusMuscles).toContain("triceps");
    const covered = targets(plan);
    expect(covered.has("chest")).toBe(true);
    expect(covered.has("triceps")).toBe(true);
  });

  it("maps biceps and rhomboids to stretchable muscles on a pull day", () => {
    const plan = buildEveningStretchSession({
      exercises: [
        ex("Bent-Over Barbell Row", 4, "bent-over-barbell-row"),
        ex("Barbell Curl", 3),
      ],
      activities: [],
    });
    expect(plan.focusMuscles).not.toContain("biceps");
    expect(plan.focusMuscles).not.toContain("rhomboids");
    expect(plan.focusMuscles).toContain("lats");
    expect(plan.focusMuscles).toEqual(
      expect.arrayContaining(["rear shoulders"]),
    );
    const covered = targets(plan);
    expect(covered.has("lats")).toBe(true);
    expect(covered.has("rear shoulders")).toBe(true);
    expect(
      covered.has("chest") ||
        covered.has("front shoulders") ||
        covered.has("traps"),
    ).toBe(true);
  });

  it("splits remapped load equally between targets", () => {
    const plan = buildEveningStretchSession({
      exercises: [ex("Barbell Curl", 4, "barbell-curl")],
      activities: [],
    });
    // biceps 4 -> chest 2 + front shoulders 2; brachialis 2 -> forearms 2;
    // forearms 2 -> forearms 4 total.
    expect(plan.focusMuscles).toEqual(["forearms", "chest", "front shoulders"]);
  });

  it("builds a running-only session", () => {
    const plan = buildEveningStretchSession({
      exercises: [],
      activities: ["running"],
    });
    expect(plan.basis).toBe("today");
    expect(plan.focusMuscles).toEqual([
      "calves",
      "hamstrings",
      "quadriceps",
      "glutes",
    ]);
    const covered = targets(plan);
    for (const muscle of ["calves", "hamstrings", "quadriceps"]) {
      expect(covered.has(muscle)).toBe(true);
    }
    // Three bodyweight stretches cover running; one general stretch pads it.
    expect(plan.steps.length).toBeGreaterThanOrEqual(4);
  });

  it("builds a bouldering-only session", () => {
    const plan = buildEveningStretchSession({
      exercises: [],
      activities: ["bouldering"],
    });
    expect(plan.focusMuscles).toEqual([
      "forearms",
      "lats",
      "rear shoulders",
      "chest", // ties with front shoulders (1) and sorts first alphabetically
    ]);
    const covered = targets(plan);
    for (const muscle of ["forearms", "lats", "rear shoulders"]) {
      expect(covered.has(muscle)).toBe(true);
    }
  });

  it("does not double an activity listed twice", () => {
    expect(
      buildEveningStretchSession({
        exercises: [],
        activities: ["running", "running"],
      }),
    ).toEqual(
      buildEveningStretchSession({ exercises: [], activities: ["running"] }),
    );
  });

  it("falls back to the general set for unresolved names", () => {
    const plan = buildEveningStretchSession({
      exercises: [ex("My Secret Move", 5), ex("Another Custom One", 2)],
      activities: [],
    });
    expect(plan.basis).toBe("general");
    expect(plan.focusMuscles).toEqual([]);
    expect(plan.steps.map((s) => s.exerciseId)).toEqual(GENERAL_STRETCH_IDS);
    expect(plan.steps.length).toBeGreaterThanOrEqual(3);
    expect(formatStretchFocus(plan)).toBe("Full body");
  });

  it("falls back to the general set for empty input and ignores stretches", () => {
    const empty = buildEveningStretchSession({ exercises: [], activities: [] });
    expect(empty.basis).toBe("general");
    const onlyStretch = buildEveningStretchSession({
      exercises: [ex("Child's Pose", 3, "childs-pose")],
      activities: [],
    });
    expect(onlyStretch.basis).toBe("general");
  });

  it("uses only bodyweight stretches by default", () => {
    const plan = buildEveningStretchSession({
      exercises: [ex("Barbell Bench Press", 4, "barbell-bench-press")],
      activities: ["running"],
      maxSteps: 8,
    });
    expect(plan.steps.length).toBeGreaterThan(0);
    for (const step of plan.steps) {
      expect(stretchOf(step.exerciseId).equipment).toEqual(["bodyweight"]);
    }
  });

  it("can include bench stretches when bench is allowed", () => {
    const plan = buildEveningStretchSession({
      exercises: [],
      activities: ["running"],
      availableEquipment: ["bodyweight", "bench", "resistance_bands"],
    });
    expect(plan.steps.map((s) => s.exerciseId)).toContain(
      "exercise-bench-bulgarian-split-stretch",
    );
    const benchOnly = buildEveningStretchSession({
      exercises: [],
      activities: ["running"],
      availableEquipment: ["bench"],
      maxSteps: 8,
    });
    expect(benchOnly.steps.length).toBeGreaterThan(0);
    for (const step of benchOnly.steps) {
      expect(stretchOf(step.exerciseId).equipment).toEqual(["bench"]);
    }
  });

  it("clamps maxSteps to [3, 8] and defaults to 6", () => {
    const wide: StretchSessionInput = {
      exercises: [
        ex("Barbell Back Squat", 4),
        ex("Barbell Bench Press", 4, "barbell-bench-press"),
        ex("Bent-Over Barbell Row", 4, "bent-over-barbell-row"),
        ex("Bent-Over Barbell Row", 4, "bent-over-barbell-row"),
      ],
      activities: ["running", "bouldering"],
    };
    expect(buildEveningStretchSession(wide).steps.length).toBeLessThanOrEqual(
      6,
    );
    expect(
      buildEveningStretchSession({ ...wide, maxSteps: 1 }).steps.length,
    ).toBe(3);
    expect(
      buildEveningStretchSession({ ...wide, maxSteps: 100 }).steps.length,
    ).toBeLessThanOrEqual(8);
    expect(
      buildEveningStretchSession({ ...wide, maxSteps: Number.NaN }).steps
        .length,
    ).toBeLessThanOrEqual(6);
    expect(
      buildEveningStretchSession({ exercises: [], activities: [], maxSteps: 2 })
        .steps.length,
    ).toBe(3);
    expect(
      buildEveningStretchSession({
        exercises: [],
        activities: [],
        maxSteps: 50,
      }).steps.length,
    ).toBe(6);
  });

  it("pads to three steps from the general set without duplicates", () => {
    const plan = buildEveningStretchSession({
      exercises: [ex("Barbell Curl", 3, "barbell-curl")],
      activities: [],
      availableEquipment: ["bodyweight"],
    });
    expect(plan.steps.length).toBeGreaterThanOrEqual(3);
    const ids = plan.steps.map((s) => s.exerciseId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic and never mutates its input", () => {
    const input: StretchSessionInput = {
      exercises: [ex("Barbell Back Squat", 4), ex("Unknown", 2)],
      activities: ["running"],
      availableEquipment: ["bodyweight", "bench"],
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    const a = buildEveningStretchSession(input);
    const b = buildEveningStretchSession(input);
    expect(a).toEqual(b);
    expect(input).toEqual(snapshot);
  });

  it("returns unique catalog stretches with consistent totals", () => {
    for (const input of [
      legDay,
      { exercises: [], activities: ["running", "bouldering"] },
      { exercises: [], activities: [] },
    ] as StretchSessionInput[]) {
      for (const maxSteps of [3, 6, 8]) {
        const plan = buildEveningStretchSession({ ...input, maxSteps });
        const ids = plan.steps.map((s) => s.exerciseId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const step of plan.steps) {
          expect(
            EXERCISE_CATALOG.find((e) => e.id === step.exerciseId)?.category,
          ).toBe("stretching");
          expect(step.holdSeconds).toBe(STRETCH_HOLD_SECONDS);
        }
        expect(plan.totalSeconds).toBe(
          plan.steps.reduce(
            (sum, s) => sum + s.holdSeconds * (s.bothSides ? 2 : 1),
            0,
          ),
        );
      }
    }
  });

  it("detects both-sides stretches from the instructions", () => {
    const plan = buildEveningStretchSession({
      exercises: [],
      activities: [],
      maxSteps: 8,
    });
    for (const step of plan.steps) {
      const expected = step.instructions.some((line) =>
        /switch sides|other side|each side|opposite side|both sides/i.test(
          line,
        ),
      );
      expect(step.bothSides).toBe(expected);
    }
    const all = EXERCISE_CATALOG.filter((e) => e.category === "stretching");
    expect(
      all.some((e) =>
        e.instructions.some((line) => /switch sides|other side/i.test(line)),
      ),
    ).toBe(true);
  });

  it("handles odd set counts without throwing", () => {
    const plan = buildEveningStretchSession({
      exercises: [
        ex("Barbell Back Squat", Number.NaN),
        ex("Barbell Bench Press", -3, "barbell-bench-press"),
        ex(
          "Bent-Over Barbell Row",
          Number.POSITIVE_INFINITY,
          "bent-over-barbell-row",
        ),
      ],
      activities: [],
    });
    expect(plan.basis).toBe("today");
    expect(plan.steps.length).toBeGreaterThanOrEqual(3);
  });
});

describe("formatStretchFocus", () => {
  it("joins muscles in plain wording", () => {
    const base = { basis: "today", steps: [], totalSeconds: 0 } as const;
    expect(
      formatStretchFocus({
        ...base,
        focusMuscles: ["hamstrings", "glutes", "lower back"],
      }),
    ).toBe("Hamstrings, glutes and lower back");
    expect(
      formatStretchFocus({ ...base, focusMuscles: ["chest", "triceps"] }),
    ).toBe("Chest and triceps");
    expect(formatStretchFocus({ ...base, focusMuscles: ["calves"] })).toBe(
      "Calves",
    );
  });
});

describe("saved exercise names (#298 device report)", () => {
  // Adam's Push 1 on 2026-10-19: five of seven names come from the earlier
  // catalog, which previously resolved to nothing and produced hamstring and
  // hip stretches after an upper-body day.
  const push1 = [
    { name: "Standing Barbell Press Behind Neck", setCount: 4 },
    { name: "Dips - Chest Version", setCount: 2 },
    { name: "Incline Dumbbell Bench With Palms Facing In", setCount: 3 },
    { name: "Side Lateral Raise", setCount: 4 },
    { name: "Cable Triceps Pushdown", setCount: 3 },
    { name: "Incline Cable Flye", setCount: 3 },
    { name: "Cable Crunch", setCount: 3 },
  ];

  it("resolves earlier catalog names and everyday aliases", () => {
    for (const { name } of push1) {
      expect(resolveStretchSourceExercise({ name })).not.toBeNull();
    }
    expect(resolveStretchSourceExercise({ name: "lat raise" })?.id).toBe(
      "exercise-lateral-raise",
    );
    expect(resolveStretchSourceExercise({ name: "My custom move" })).toBe(null);
  });

  it("stretches the chest and shoulders after a push day, never the legs", () => {
    const plan = buildEveningStretchSession({
      exercises: push1,
      activities: [],
    });
    expect(plan.basis).toBe("today");
    expect(plan.focusMuscles[0]).toBe("chest");
    expect(plan.focusMuscles).toEqual(
      expect.arrayContaining(["triceps", "front shoulders"]),
    );
    const covered = targets(plan);
    expect(covered.has("chest")).toBe(true);
    expect(covered.has("triceps")).toBe(true);
    for (const leg of ["hamstrings", "hip flexors", "quadriceps", "calves"]) {
      expect(covered.has(leg)).toBe(false);
    }
  });

  it("pads a short plan only with stretches for trained muscles", () => {
    const plan = buildEveningStretchSession({
      exercises: [{ name: "Cable Triceps Pushdown", setCount: 3 }],
      activities: [],
    });
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    for (const step of plan.steps) {
      expect(step.targetMuscles).toContain("triceps");
    }
  });
});
