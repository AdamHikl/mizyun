import { describe, expect, it } from "vitest";
import { EXERCISE_CATALOG, getExerciseFromCatalog } from "./exercise-catalog";
import {
  GENERAL_STRETCH_IDS,
  STRETCH_HOLD_SECONDS,
  buildEveningStretchSession,
  formatStretchFocus,
  type StretchSessionInput,
  resolveStretchSourceExercise,
  STRETCH_MAX_HOLD_SECONDS,
  STRETCH_MIN_HOLD_SECONDS,
  STRETCH_MUSCLE_VOCABULARY,
  listStretchOptions,
  stretchPlanCoversEverySource,
  stretchPlanFromChoice,
  stretchRequiredMuscles,
  unresolvedStretchExerciseNames,
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

describe("AI refinement inputs and validation", () => {
  const options = listStretchOptions();
  const ids = options.map((option) => option.id);

  it("lists only bodyweight catalog stretches by default", () => {
    expect(options.length).toBeGreaterThan(20);
    for (const option of options) {
      const entry = getExerciseFromCatalog(option.id);
      expect(entry?.category).toBe("stretching");
      expect(entry?.equipment).toEqual(["bodyweight"]);
    }
  });

  it("names only the exercises the catalog cannot resolve", () => {
    expect(
      unresolvedStretchExerciseNames({
        exercises: [
          { name: "Chest Dips", setCount: 3 },
          { name: "Landmine twist  ", setCount: 2 },
          { name: "landmine TWIST", setCount: 1 },
        ],
        activities: [],
      }),
    ).toEqual(["Landmine twist"]);
  });

  it("counts muscle tags for custom exercises only", () => {
    const custom = buildEveningStretchSession({
      exercises: [{ name: "Backyard log carry", setCount: 4 }],
      activities: [],
      muscleTags: {
        "backyard LOG carry": ["quadriceps", "glutes", "not-a-muscle"],
      },
    });
    expect(custom.basis).toBe("today");
    expect(custom.focusMuscles).toEqual(["glutes", "quadriceps"]);
    // A resolvable name ignores its tag.
    const resolved = buildEveningStretchSession({
      exercises: [{ name: "Cable Triceps Pushdown", setCount: 3 }],
      activities: [],
      muscleTags: { "Cable Triceps Pushdown": ["calves"] },
    });
    expect(resolved.focusMuscles).not.toContain("calves");
    expect(STRETCH_MUSCLE_VOCABULARY).toContain("quadriceps");
  });

  const input: StretchSessionInput = {
    exercises: [{ name: "Chest Dips", setCount: 3 }],
    activities: [],
  };

  it("builds a plan from a valid choice with clamped holds", () => {
    const plan = stretchPlanFromChoice(input, {
      picks: [
        { id: ids[0]!, holdSeconds: 5 },
        { id: ids[1]!, holdSeconds: 90 },
        { id: ids[2]!, holdSeconds: 33.4 },
      ],
      focusMuscles: ["chest", "bogus", "chest", "triceps"],
    });
    // Stretches added for uncovered required muscles follow the picks.
    expect(plan?.steps.slice(0, 3).map((step) => step.holdSeconds)).toEqual([
      STRETCH_MIN_HOLD_SECONDS,
      STRETCH_MAX_HOLD_SECONDS,
      33,
    ]);
    expect(plan?.focusMuscles).toEqual(["chest", "triceps"]);
    expect(plan?.steps[0]?.instructions).toEqual(
      getExerciseFromCatalog(ids[0]!)?.instructions,
    );
    expect(plan?.totalSeconds).toBe(
      plan!.steps.reduce(
        (sum, step) => sum + step.holdSeconds * (step.bothSides ? 2 : 1),
        0,
      ),
    );
  });

  it("falls back to the deterministic focus when none is valid", () => {
    const plan = stretchPlanFromChoice(input, {
      picks: ids.slice(0, 3).map((id) => ({ id, holdSeconds: 30 })),
      focusMuscles: ["bogus"],
    });
    expect(plan?.focusMuscles).toEqual(
      buildEveningStretchSession(input).focusMuscles,
    );
  });

  it.each([
    ["too few", ids.slice(0, 2)],
    ["too many", ids.slice(0, 7)],
    ["duplicates", [ids[0]!, ids[0]!, ids[1]!]],
    ["unknown id", [ids[0]!, ids[1]!, "made-up-stretch"]],
    ["not a stretch", [ids[0]!, ids[1]!, "barbell-squat"]],
    [
      "equipment not allowed",
      [ids[0]!, ids[1]!, "exercise-bench-couch-stretch"],
    ],
  ])("rejects a choice with %s", (_label, picked) => {
    expect(
      stretchPlanFromChoice(input, {
        picks: picked.map((id) => ({ id, holdSeconds: 30 })),
      }),
    ).toBeNull();
  });

  it("rejects malformed choices", () => {
    expect(stretchPlanFromChoice(input, { picks: null as never })).toBeNull();
    expect(
      stretchPlanFromChoice(input, {
        picks: [null, null, null] as never,
      }),
    ).toBeNull();
  });
});

describe("per-source stretch coverage", () => {
  const sessionEx = (name: string, setCount: number, session: string) => ({
    ...ex(name, setCount),
    session,
  });

  it("stretches a climb after a big push session", () => {
    const plan = buildEveningStretchSession({
      exercises: [
        sessionEx("Dumbbell bench press", 4, "a"),
        sessionEx("Dumbbell shoulder press", 4, "a"),
        sessionEx("Chest Dips", 3, "a"),
        sessionEx("Cable Fly", 4, "a"),
        sessionEx("Cable Rope Overhead Triceps Extension", 3, "a"),
        sessionEx("Cable Pallof Press", 4, "a"),
        sessionEx("Cable Crunch", 3, "a"),
      ],
      activities: ["bouldering"],
    });
    const wanted = (muscle: string) =>
      muscle === "forearms" || muscle === "lats";
    expect(plan.steps.some((step) => step.targetMuscles.some(wanted))).toBe(
      true,
    );
    expect(plan.focusMuscles.some(wanted)).toBe(true);
    expect(plan.focusMuscles.length).toBeLessThanOrEqual(4);
  });

  it("covers a small second workout after a heavy legs workout", () => {
    const plan = buildEveningStretchSession({
      exercises: [
        sessionEx("Barbell Back Squat", 8, "a"),
        sessionEx("Banded Romanian Deadlift", 8, "a"),
        sessionEx("Barbell Bench Press", 2, "b"),
      ],
      activities: [],
    });
    const upper = new Set(["chest", "front shoulders", "triceps"]);
    expect(
      plan.steps.some((step) => step.targetMuscles.some((m) => upper.has(m))),
    ).toBe(true);
    expect(plan.focusMuscles.some((m) => upper.has(m))).toBe(true);
    expect(
      plan.steps.some((step) =>
        step.targetMuscles.some(
          (m) => m === "quadriceps" || m === "hamstrings",
        ),
      ),
    ).toBe(true);
    expect(
      plan.focusMuscles.some(
        (m) => m === "quadriceps" || m === "hamstrings" || m === "glutes",
      ),
    ).toBe(true);
  });

  it("gives an unresolved timed activity a full-body load", () => {
    const timed = buildEveningStretchSession({
      exercises: [{ name: "Paddleboarding", setCount: 1, timed: true }],
      activities: [],
    });
    expect(timed.basis).toBe("today");
    expect([...targets(timed)]).toEqual(
      expect.arrayContaining(["hamstrings", "hip flexors", "chest"]),
    );
    const untimed = buildEveningStretchSession({
      exercises: [{ name: "Paddleboarding", setCount: 1 }],
      activities: [],
    });
    expect(untimed.basis).toBe("general");
    expect(untimed.focusMuscles).toEqual([]);
  });

  it("does not double a repeated timed activity within one source", () => {
    const once = buildEveningStretchSession({
      exercises: [{ name: "Paddleboarding", setCount: 1, timed: true }],
      activities: [],
    });
    const twice = buildEveningStretchSession({
      exercises: [
        { name: "Paddleboarding", setCount: 1, timed: true },
        { name: " paddleboarding ", setCount: 1, timed: true },
      ],
      activities: [],
    });
    expect(twice).toEqual(once);
  });
});

describe("stretchPlanCoversEverySource", () => {
  const push = [
    { name: "Dumbbell bench press", setCount: 4, session: "a" },
    { name: "Cable Fly", setCount: 4, session: "a" },
  ];
  const input = { exercises: push, activities: ["bouldering" as const] };

  it("accepts the deterministic plan and rejects one that drops a source", () => {
    const plan = buildEveningStretchSession(input);
    expect(stretchPlanCoversEverySource(input, plan)).toBe(true);
    const chestOnly = {
      steps: plan.steps.filter(
        (step) =>
          !step.targetMuscles.some((muscle) =>
            [
              "forearms",
              "lats",
              "rear shoulders",
              "front shoulders",
              "hip flexors",
            ].includes(muscle),
          ),
      ),
    };
    expect(stretchPlanCoversEverySource(input, chestOnly)).toBe(false);
  });

  it("always accepts a single-source plan", () => {
    expect(
      stretchPlanCoversEverySource(
        { exercises: push, activities: [] },
        { steps: [] },
      ),
    ).toBe(true);
  });
});

describe("single-source focus order", () => {
  it("keeps the plain ranking when the top muscle has no stretch", () => {
    const input = {
      exercises: [{ name: "Pike shoulder press", setCount: 3 }],
      activities: [],
    };
    // Front shoulders are worked most but have no bodyweight stretch.
    expect(buildEveningStretchSession(input).focusMuscles[0]).toBe(
      "front shoulders",
    );
  });
});

describe("required-muscle coverage of a chosen plan", () => {
  // Adam's pull day (2026-10-23 device report): the model chose two lat
  // stretches, a rear-shoulder and a wrist stretch, and nothing for 4 sets
  // of curls plus the biceps work of every row and pulldown.
  const pullDay: StretchSessionInput = {
    exercises: [
      ex("Lat Pulldown", 4),
      ex("Seated cable row", 3),
      ex("Bench-supported single-arm dumbbell row", 2),
      ex("Dumbbell Lateral Raise", 3),
      ex("Incline Dumbbell Curl", 2),
      ex("Incline Hammer Curl", 2),
      ex("Straight-Arm Pulldown", 3),
    ],
    activities: [],
  };
  const reported = [
    "childs-pose",
    "exercise-puppy-pose",
    "exercise-cross-body-shoulder-stretch",
    "exercise-kneeling-wrist-stretch",
  ];
  const pick = (ids: readonly string[], holdSeconds = 35) =>
    ids.map((id) => ({ id, holdSeconds }));

  it("requires the top reachable muscles, biceps through the chest", () => {
    expect(stretchRequiredMuscles(pullDay)).toEqual([
      "rear shoulders",
      "lats",
      "chest",
    ]);
    expect(stretchRequiredMuscles({ exercises: [], activities: [] })).toEqual(
      [],
    );
  });

  it("adds the deterministic stretch for a muscle the model left out", () => {
    const plan = stretchPlanFromChoice(pullDay, {
      picks: pick(reported),
      focusMuscles: ["lats", "rear shoulders"],
    });
    expect(plan?.steps.map((step) => step.exerciseId)).toEqual([
      ...reported,
      "exercise-doorway-chest-stretch",
    ]);
    expect(plan?.steps[4]?.holdSeconds).toBe(STRETCH_HOLD_SECONDS);
    expect(plan?.focusMuscles).toEqual(["rear shoulders", "lats", "chest"]);
  });

  it("is stable when the repaired plan is validated again on the device", () => {
    const first = stretchPlanFromChoice(pullDay, {
      picks: pick(reported),
      focusMuscles: ["lats", "rear shoulders"],
    })!;
    const again = stretchPlanFromChoice(pullDay, {
      picks: first.steps.map((step) => ({
        id: step.exerciseId,
        holdSeconds: step.holdSeconds,
      })),
      focusMuscles: first.focusMuscles,
    });
    expect(again).toEqual(first);
  });

  it("leaves the deterministic plan unchanged", () => {
    for (const day of [pullDay, legDay]) {
      const deterministic = buildEveningStretchSession(day);
      const echoed = stretchPlanFromChoice(day, {
        picks: deterministic.steps.map((step) => ({
          id: step.exerciseId,
          holdSeconds: step.holdSeconds,
        })),
        focusMuscles: deterministic.focusMuscles,
      });
      expect(echoed?.steps.map((step) => step.exerciseId)).toEqual(
        deterministic.steps.map((step) => step.exerciseId),
      );
    }
  });

  it("replaces a redundant pick when six are already chosen", () => {
    const six = [
      ...reported,
      "exercise-thread-the-needle",
      "exercise-overhead-triceps-stretch",
    ];
    const plan = stretchPlanFromChoice(pullDay, { picks: pick(six) });
    const ids = plan?.steps.map((step) => step.exerciseId);
    // Cross-Body Shoulder Stretch (rear shoulders) is the last pick whose
    // muscles another pick (Puppy Pose) also stretches.
    expect(ids).toEqual([
      "childs-pose",
      "exercise-puppy-pose",
      "exercise-kneeling-wrist-stretch",
      "exercise-thread-the-needle",
      "exercise-overhead-triceps-stretch",
      "exercise-doorway-chest-stretch",
    ]);
  });

  it("rejects six picks that miss a required muscle with none redundant", () => {
    const six = [
      "exercise-puppy-pose",
      "exercise-kneeling-wrist-stretch",
      "exercise-overhead-triceps-stretch",
      "exercise-standing-calf-stretch",
      "exercise-seated-forward-fold",
      "exercise-kneeling-hip-flexor-stretch",
    ];
    expect(stretchPlanFromChoice(pullDay, { picks: pick(six) })).toBeNull();
    // The same picks with room to spare get the chest stretch instead.
    expect(
      stretchPlanFromChoice(pullDay, {
        picks: pick(six.slice(0, 5)),
      })?.steps.at(-1)?.exerciseId,
    ).toBe("exercise-doorway-chest-stretch");
  });

  it("ignores model muscle tags, so server and device require the same", () => {
    const withCustom: StretchSessionInput = {
      ...pullDay,
      exercises: [...pullDay.exercises, ex("KB complex", 12)],
    };
    expect(
      stretchRequiredMuscles({
        ...withCustom,
        muscleTags: { "KB complex": ["hamstrings", "glutes", "lower back"] },
      }),
    ).toEqual(stretchRequiredMuscles(withCustom));
  });
});
