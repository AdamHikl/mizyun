import { describe, expect, it } from "vitest";
import {
  EXERCISE_CATALOG,
  getExerciseFromCatalog,
  searchExerciseCatalog,
  findCatalogExercise,
  getCatalogExerciseNames,
  TRAINING_EXERCISE_CATALOG,
} from "./exercise-catalog";
import { EQUIPMENT_OPTIONS, TRAINING_LIMITATION_OPTIONS } from "./profile";
import { LEGACY_EXERCISE_CATALOG } from "./exercise-catalog-legacy";
import { SUPPLEMENTAL_EXERCISE_CATALOG } from "./exercise-catalog-supplement";

/** 609 RepDB entries plus the Mizyun-authored timed activities (#278). */
const ACTIVE_COUNT = 612;

describe("exercise-catalog", () => {
  it("contains all catalog exercises with non-empty fields", () => {
    expect(EXERCISE_CATALOG.length).toBe(ACTIVE_COUNT);

    const validEquipment = new Set(EQUIPMENT_OPTIONS);
    const validLimitations = new Set(TRAINING_LIMITATION_OPTIONS);
    const validPatterns = new Set([
      "knee_dominant",
      "hip_hinge",
      "horizontal_push",
      "horizontal_pull",
      "vertical_push",
      "vertical_pull",
      "core",
      "aerobic",
      "mobility",
    ]);
    const validFocus = new Set([
      "balanced",
      "strength",
      "hypertrophy",
      "endurance",
    ]);

    const seenIds = new Set<string>();

    for (const ex of EXERCISE_CATALOG) {
      expect(ex.id).toBeTruthy();
      expect(seenIds.has(ex.id)).toBe(false);
      seenIds.add(ex.id);

      expect(ex.name.trim().length).toBeGreaterThan(0);
      expect(validPatterns.has(ex.movementPattern)).toBe(true);

      for (const eq of ex.equipment) {
        expect(validEquipment.has(eq)).toBe(true);
      }

      for (const block of ex.blockedBy) {
        expect(validLimitations.has(block)).toBe(true);
      }

      expect(ex.focusFit.length).toBeGreaterThan(0);
      for (const f of ex.focusFit) {
        expect(validFocus.has(f)).toBe(true);
      }

      expect(Array.isArray(ex.instructions)).toBe(true);
      expect(ex.instructions.length).toBeGreaterThan(0);
      expect(ex.instructions.every((step) => step.trim().length > 0)).toBe(
        true,
      );
      expect(ex.description?.trim().length).toBeGreaterThan(0);
      // Supplements are Mizyun-authored and must not claim RepDB provenance.
      expect(ex.source?.provider).toBe(
        SUPPLEMENTAL_EXERCISE_CATALOG.includes(ex) ? undefined : "repdb",
      );
      expect(ex.contentReview).toEqual({
        status: "pending_professional",
        reviewedAt: null,
      });
      expect(ex.demonstration).toBeNull();
      expect(ex.requiredEquipment?.length).toBeGreaterThan(0);
      expect(Array.isArray(ex.primaryMuscles)).toBe(true);
    }
  });

  it("retrieves an exercise by id via getExerciseFromCatalog", () => {
    const squat = getExerciseFromCatalog("barbell-squat");
    expect(squat).not.toBeNull();
    expect(squat?.name.toLowerCase()).toContain("squat");
    expect(squat?.movementPattern).toBe("knee_dominant");

    const nonExistent = getExerciseFromCatalog("non-existent-exercise-xyz");
    expect(nonExistent).toBeNull();
  });

  it("keeps every saved legacy ID resolvable without surfacing archived entries in browse", () => {
    expect(LEGACY_EXERCISE_CATALOG).toHaveLength(888);
    for (const old of LEGACY_EXERCISE_CATALOG) {
      expect(getExerciseFromCatalog(old.id)?.id).toBe(old.id);
    }
    const activeIds = new Set(EXERCISE_CATALOG.map((exercise) => exercise.id));
    const archived = LEGACY_EXERCISE_CATALOG.find(
      (exercise) => !activeIds.has(exercise.id),
    )!;
    expect(getExerciseFromCatalog(archived.id)).toEqual(archived);
    expect(
      searchExerciseCatalog({ limit: 1000 }).some(
        (exercise) => exercise.id === archived.id,
      ),
    ).toBe(false);
  });

  it("makes every active exercise reachable across disjoint pages", () => {
    const ids: string[] = [];
    for (let offset = 0; offset < ACTIVE_COUNT; offset += 60) {
      ids.push(
        ...searchExerciseCatalog({ offset, limit: 60 }).map(
          (exercise) => exercise.id,
        ),
      );
    }
    expect(ids).toHaveLength(ACTIVE_COUNT);
    expect(new Set(ids).size).toBe(ACTIVE_COUNT);
    expect(searchExerciseCatalog({ offset: ACTIVE_COUNT, limit: 60 })).toEqual(
      [],
    );
  });

  it("adds swimming, outdoor cycling and hiking in alphabetical position", () => {
    expect(findCatalogExercise("swimming")?.id).toBe("exercise-swimming");
    expect(findCatalogExercise("cycling")?.id).toBe("exercise-outdoor-cycling");
    // Existing lookups (e.g. Coach tools) keep their previous best hit.
    expect(findCatalogExercise("bike")?.id).toBe("exercise-air-bike");
    expect(searchExerciseCatalog({ query: "hike" })[0]?.id).toBe(
      "exercise-hiking",
    );
    const names = EXERCISE_CATALOG.map((exercise) => exercise.name);
    for (const extra of SUPPLEMENTAL_EXERCISE_CATALOG) {
      const index = names.indexOf(extra.name);
      expect(names[index - 1]!.localeCompare(extra.name)).toBeLessThan(0);
      expect(names[index + 1]!.localeCompare(extra.name)).toBeGreaterThan(0);
    }
  });

  it("ranks exact names and shorthand aliases first and normalizes punctuation", () => {
    const bench = findCatalogExercise("db bench")!;
    expect(searchExerciseCatalog({ query: "DB bench" })[0]?.id).toBe(bench.id);
    const active = EXERCISE_CATALOG.find((exercise) =>
      exercise.name.includes("-"),
    )!;
    expect(
      searchExerciseCatalog({ query: active.name.replaceAll("-", " ") })[0]?.id,
    ).toBe(active.id);
  });

  it("searches exercises by text query", () => {
    const benchPresses = searchExerciseCatalog({ query: "bench press" });
    expect(benchPresses.length).toBeGreaterThan(0);
    expect(benchPresses.some((ex) => ex.id === "barbell-bench-press")).toBe(
      true,
    );
    expect(benchPresses.some((ex) => ex.id === "dumbbell-bench-press")).toBe(
      true,
    );
  });

  it("fresh name lookup uses the new plank while saved legacy ID keeps its original definition", () => {
    expect(findCatalogExercise("plank")?.source?.provider).toBe("repdb");
    expect(findCatalogExercise("plank")?.id).toBe("front-plank");
    expect(searchExerciseCatalog({ query: "Front plank" })[0]?.id).toBe(
      "front-plank",
    );
    expect(getExerciseFromCatalog("plank")).toEqual(
      LEGACY_EXERCISE_CATALOG.find((exercise) => exercise.id === "plank"),
    );
  });

  it("keeps previous exact labels for reused UUID lookup and limits automatic plans to known variants", () => {
    const rdl = findCatalogExercise("rdl")!;
    expect(getCatalogExerciseNames(rdl)).toContain("Romanian Deadlift");
    // Automatic plans retain the known-variant order and exclude new specialty rows.
    const legacyIds = LEGACY_EXERCISE_CATALOG.map((exercise) => exercise.id);
    expect(TRAINING_EXERCISE_CATALOG.length).toBeGreaterThan(0);
    const indices = TRAINING_EXERCISE_CATALOG.map((exercise) =>
      legacyIds.indexOf(exercise.id),
    );
    expect(indices.every((index) => index >= 0)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it("filters exercises by movement pattern", () => {
    const coreOnly = searchExerciseCatalog({ movementPattern: "core" });
    expect(coreOnly.length).toBeGreaterThan(0);
    expect(coreOnly.every((ex) => ex.movementPattern === "core")).toBe(true);
  });

  it("filters exercises by equipment", () => {
    expect(
      searchExerciseCatalog({
        query: "dumbbells",
        limit: EXERCISE_CATALOG.length,
      }).some((exercise) => exercise.id === "dumbbell-rdl"),
    ).toBe(true);
    expect(
      searchExerciseCatalog({
        query: "bodyweight",
        limit: EXERCISE_CATALOG.length,
      }).some((exercise) => exercise.id === "front-plank"),
    ).toBe(true);
    const dumbbellsOnly = searchExerciseCatalog({
      equipment: ["dumbbells"],
      limit: 100,
    });
    expect(dumbbellsOnly.length).toBeGreaterThan(0);
    expect(
      dumbbellsOnly.every(
        (ex) =>
          ex.equipment.length === 0 ||
          ex.equipment.every((eq) => eq === "dumbbells" || eq === "bodyweight"),
      ),
    ).toBe(true);
  });

  it("finds exercises by alias, common shorthand, and fuzzy matching via findCatalogExercise", () => {
    const rdl = findCatalogExercise("rdl");
    expect(rdl).not.toBeNull();
    expect(rdl?.name.toLowerCase()).toContain("deadlift");

    const dbBench = findCatalogExercise("db bench");
    expect(dbBench).not.toBeNull();
    expect(dbBench?.name.toLowerCase()).toContain("dumbbell bench");

    const incline = findCatalogExercise("incline db press");
    expect(incline).not.toBeNull();
    expect(incline?.name.toLowerCase()).toContain("incline");

    const latRaise = findCatalogExercise("cable lateral raise");
    expect(latRaise).not.toBeNull();
    expect(latRaise?.name.toLowerCase()).toContain("lateral raise");

    const bicepCurl = findCatalogExercise("bicep curls");
    expect(bicepCurl).not.toBeNull();
    expect(bicepCurl?.name.toLowerCase()).toContain("curl");

    const bulgarian = findCatalogExercise("bulgarian split squats");
    expect(bulgarian).not.toBeNull();
    expect(bulgarian?.name.toLowerCase()).toContain("squat");

    const exactMatch = findCatalogExercise("Barbell bench press");
    expect(exactMatch).not.toBeNull();
    expect(exactMatch?.id).toBe("barbell-bench-press");

    const nonMatch = findCatalogExercise("unknown non existent exercise 12345");
    expect(nonMatch).toBeNull();
  });
});
