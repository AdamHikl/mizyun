import { describe, expect, it } from "vitest";
import {
  EXERCISE_CATALOG,
  getExerciseFromCatalog,
  searchExerciseCatalog,
} from "./exercise-catalog";
import { EQUIPMENT_OPTIONS, TRAINING_LIMITATION_OPTIONS } from "./profile";

describe("exercise-catalog", () => {
  it("contains all catalog exercises with non-empty fields", () => {
    expect(EXERCISE_CATALOG.length).toBeGreaterThanOrEqual(870);

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
      expect(Array.isArray(ex.primaryMuscles)).toBe(true);
    }
  });

  it("retrieves an exercise by id via getExerciseFromCatalog", () => {
    const squat = getExerciseFromCatalog("barbell-squat");
    expect(squat).not.toBeNull();
    expect(squat?.name).toBe("Barbell squat");
    expect(squat?.movementPattern).toBe("knee_dominant");

    const nonExistent = getExerciseFromCatalog("non-existent-exercise-xyz");
    expect(nonExistent).toBeNull();
  });

  it("searches exercises by text query", () => {
    const benchPresses = searchExerciseCatalog({ query: "bench press" });
    expect(benchPresses.length).toBeGreaterThan(0);
    expect(
      benchPresses.every((ex) => ex.name.toLowerCase().includes("bench")),
    ).toBe(true);
  });

  it("filters exercises by movement pattern", () => {
    const coreOnly = searchExerciseCatalog({ movementPattern: "core" });
    expect(coreOnly.length).toBeGreaterThan(0);
    expect(coreOnly.every((ex) => ex.movementPattern === "core")).toBe(true);
  });

  it("filters exercises by equipment", () => {
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
});
