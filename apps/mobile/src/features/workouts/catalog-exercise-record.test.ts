import { describe, expect, it } from "vitest";
import { getExerciseFromCatalog } from "@mizyun/core";
import { findCatalogExerciseRecord } from "./catalog-exercise-record";

describe("catalog exercise record compatibility", () => {
  const catalogExercise = getExerciseFromCatalog("barbell-rdl")!;
  const previous = {
    id: "original-uuid",
    name: "Romanian deadlift",
    metadata: { source: "manual" },
  };
  it("reuses the exact known previous name while preserving the record", () => {
    expect(catalogExercise.name).toBe("Barbell Romanian deadlift");
    expect(findCatalogExerciseRecord([previous], catalogExercise)).toBe(
      previous,
    );
  });
  it("prefers the exact canonical record to a previous label", () => {
    const current = {
      id: "canonical-uuid",
      name: "  BARBELL ROMANIAN DEADLIFT  ",
    };
    expect(
      findCatalogExerciseRecord([previous, current], catalogExercise),
    ).toBe(current);
  });
  it("leaves multiple previous or canonical UUIDs unresolved", () => {
    expect(
      findCatalogExerciseRecord(
        [previous, { ...previous, id: "another-uuid" }],
        catalogExercise,
      ),
    ).toBeNull();
    expect(
      findCatalogExerciseRecord(
        [
          { id: "one", name: catalogExercise.name },
          { id: "two", name: catalogExercise.name },
        ],
        catalogExercise,
      ),
    ).toBeNull();
  });
  it("never matches another equipment variant or a fuzzy custom name", () => {
    expect(
      findCatalogExerciseRecord(
        [
          { id: "dumbbell-uuid", name: "Dumbbell Romanian deadlift" },
          { id: "custom-uuid", name: "My Romanian deadlift" },
        ],
        catalogExercise,
      ),
    ).toBeNull();
  });
});
