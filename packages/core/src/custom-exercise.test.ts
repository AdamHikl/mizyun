import { describe, expect, it } from "vitest";
import {
  CUSTOM_EXERCISE_PREVIOUS_NAMES_MAX,
  customExerciseMetadata,
  findSavedExerciseByName,
  customExerciseTrackingMode,
  isCustomExerciseRecord,
  normalizeCustomExerciseName,
  searchCustomExercises,
  validateCustomExerciseDraft,
} from "./custom-exercise";
import { EXERCISE_NAME_MAX, INSTRUCTIONS_MAX } from "./exercise";

const draft = (
  name: string,
  overrides: Partial<{ notes: string; trackingMode: string }> = {},
) =>
  ({
    name,
    notes: overrides.notes ?? "",
    trackingMode: overrides.trackingMode ?? "load_reps",
  }) as Parameters<typeof validateCustomExerciseDraft>[0];

describe("isCustomExerciseRecord", () => {
  it("treats catalog-linked and exact catalog names as catalog exercises", () => {
    expect(
      isCustomExerciseRecord({
        name: "My squat",
        metadata: { catalogId: "barbell-squat" },
      }),
    ).toBe(false);
    expect(isCustomExerciseRecord({ name: " forearm PLANK " })).toBe(false);
  });

  it("treats name-only and unknown catalog ids as custom", () => {
    expect(isCustomExerciseRecord({ name: "Sled push" })).toBe(true);
    expect(
      isCustomExerciseRecord({
        name: "Sled push",
        metadata: { catalogId: "not-a-real-entry", custom: true },
      }),
    ).toBe(true);
    expect(isCustomExerciseRecord({ name: "Pickleball", metadata: null })).toBe(
      true,
    );
  });
});

describe("validateCustomExerciseDraft", () => {
  it("normalizes the name and notes", () => {
    expect(
      validateCustomExerciseDraft(
        draft("  Sled   push ", {
          notes: "  Low hips  ",
          trackingMode: "duration",
        }),
        [],
      ),
    ).toEqual({
      ok: true,
      value: {
        name: "Sled push",
        instructions: "Low hips",
        trackingMode: "duration",
      },
    });
    expect(validateCustomExerciseDraft(draft("Sled push"), [])).toMatchObject({
      ok: true,
      value: { instructions: null },
    });
  });

  it("rejects blank, long names and long notes", () => {
    expect(validateCustomExerciseDraft(draft("   "), [])).toEqual({
      ok: false,
      error: { kind: "name_empty" },
    });
    expect(
      validateCustomExerciseDraft(draft("x".repeat(EXERCISE_NAME_MAX + 1)), []),
    ).toEqual({
      ok: false,
      error: { kind: "name_too_long", max: EXERCISE_NAME_MAX },
    });
    expect(
      validateCustomExerciseDraft(
        draft("Sled push", { notes: "x".repeat(INSTRUCTIONS_MAX + 1) }),
        [],
      ),
    ).toEqual({
      ok: false,
      error: { kind: "notes_too_long", max: INSTRUCTIONS_MAX },
    });
  });

  it("rejects an unknown tracking mode", () => {
    expect(
      validateCustomExerciseDraft(
        draft("Sled push", { trackingMode: "laps" }),
        [],
      ),
    ).toEqual({ ok: false, error: { kind: "invalid_tracking_mode" } });
  });

  it("points a catalog name at the catalog entry", () => {
    expect(validateCustomExerciseDraft(draft("forearm  plank"), [])).toEqual({
      ok: false,
      error: { kind: "matches_catalog", catalogName: "Forearm plank" },
    });
  });

  it("rejects a duplicate saved name except for the record being edited", () => {
    const saved = [{ id: "a", name: "Sled Push" }];
    expect(validateCustomExerciseDraft(draft("sled  push"), saved)).toEqual({
      ok: false,
      error: { kind: "matches_saved", exerciseId: "a", name: "Sled Push" },
    });
    expect(
      validateCustomExerciseDraft(draft("Sled push"), saved, saved[0]),
    ).toMatchObject({ ok: true, value: { name: "Sled push" } });
  });
});

describe("custom exercise metadata", () => {
  it("sets custom and trackingMode while keeping unrelated keys", () => {
    expect(
      customExerciseMetadata("duration_distance", {
        source: "log_activity",
        trackingMode: "load_reps",
      }),
    ).toEqual({
      source: "log_activity",
      custom: true,
      trackingMode: "duration_distance",
    });
    expect(customExerciseMetadata("load_reps", null)).toEqual({
      custom: true,
      trackingMode: "load_reps",
    });
  });

  it("starts an edit from the saved tracking mode, defaulting to load and reps", () => {
    expect(
      customExerciseTrackingMode({
        name: "Sled push",
        metadata: { trackingMode: "duration" },
      }),
    ).toBe("duration");
    expect(customExerciseTrackingMode({ name: "Sled push" })).toBe("load_reps");
  });
});

describe("searchCustomExercises", () => {
  const records = [
    { id: "1", name: "sled push" },
    { id: "2", name: "Bench press", metadata: { catalogId: "barbell-squat" } },
    { id: "3", name: "Atlas stone carry" },
    { id: "4", name: "Sled drag" },
  ];

  it("lists only custom records, sorted by name", () => {
    expect(searchCustomExercises(records, "").map((r) => r.id)).toEqual([
      "3",
      "4",
      "1",
    ]);
  });

  it("matches every query word case-insensitively", () => {
    expect(searchCustomExercises(records, "SLED pu").map((r) => r.id)).toEqual([
      "1",
    ]);
    expect(searchCustomExercises(records, "squat")).toEqual([]);
  });

  it("normalizes names", () => {
    expect(normalizeCustomExerciseName("  a \t b ")).toBe("a b");
  });
});

describe("edits that keep the name", () => {
  it("skip duplicate and catalog checks so older records stay editable", () => {
    const saved = [
      { id: "a", name: "Sled push" },
      { id: "b", name: "Sled push" },
      { id: "c", name: "Bench  press" },
    ];
    expect(
      validateCustomExerciseDraft(
        draft(" sled push ", { notes: "new" }),
        saved,
        saved[0],
      ),
    ).toMatchObject({ ok: true, value: { name: "sled push" } });
    expect(
      validateCustomExerciseDraft(draft("Bench press"), saved, saved[2]),
    ).toMatchObject({ ok: true });
    expect(
      validateCustomExerciseDraft(draft("Forearm plank"), saved, saved[2]),
    ).toMatchObject({ ok: false, error: { kind: "matches_catalog" } });
  });
});

describe("renames", () => {
  it("remembers earlier names, newest first, without the current name", () => {
    const once = customExerciseMetadata(
      "duration",
      { custom: true },
      {
        from: " Sled  push ",
        to: "Heavy sled push",
      },
    );
    expect(once.previousNames).toEqual(["Sled push"]);
    const twice = customExerciseMetadata("duration", once, {
      from: "Heavy sled push",
      to: "sled push",
    });
    expect(twice.previousNames).toEqual(["Heavy sled push"]);
    expect(
      customExerciseMetadata("duration", once, { from: "x", to: "X" })
        .previousNames,
    ).toEqual(["Sled push"]);
  });

  it("caps remembered names and ignores malformed stored values", () => {
    let metadata: Record<string, unknown> = { previousNames: [1, null] };
    for (let i = 0; i < CUSTOM_EXERCISE_PREVIOUS_NAMES_MAX + 3; i++) {
      metadata = customExerciseMetadata("load_reps", metadata, {
        from: `Name ${i}`,
        to: `Name ${i + 1}`,
      });
    }
    expect(metadata.previousNames).toHaveLength(
      CUSTOM_EXERCISE_PREVIOUS_NAMES_MAX,
    );
    expect((metadata.previousNames as string[])[0]).toBe(
      `Name ${CUSTOM_EXERCISE_PREVIOUS_NAMES_MAX + 2}`,
    );
  });

  it("finds a renamed exercise by an earlier name, preferring a current name", () => {
    const renamed = {
      id: "r",
      name: "Heavy sled push",
      metadata: { previousNames: ["Sled push"] },
    };
    expect(findSavedExerciseByName([renamed], " sled  PUSH ")).toBe(renamed);
    const current = { id: "c", name: "Sled push" };
    expect(findSavedExerciseByName([renamed, current], "Sled push")).toBe(
      current,
    );
    expect(findSavedExerciseByName([renamed], "Sled pull")).toBeUndefined();
    expect(
      findSavedExerciseByName([renamed], "Sled push", {
        includePreviousNames: false,
      }),
    ).toBeUndefined();
    expect(findSavedExerciseByName([renamed], "  ")).toBeUndefined();
  });
});
