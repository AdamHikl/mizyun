import { describe, expect, it } from "vitest";
import { healthExportPayloadSchema } from "../../contracts/src/health-export";
import {
  canReplaceHealthExport,
  hasEligibleHealthNutritionDetails,
  hasEligibleHealthWorkoutDetails,
  isHealthExportPayload,
  nextHealthExportRevision,
  projectHealthExportDeletion,
  projectHealthNutritionExport,
  projectHealthWorkoutExport,
  type HealthExportProjectionOptions,
  type HealthNutritionExportSource,
  type HealthWorkoutExportSource,
} from "./health-export";
const id = "00000000-0000-4000-8000-000000000001";
const clientId = "00000000-0000-4000-8000-000000000002";
const updatedAt = "2026-10-06T12:00:00.000Z";
const healthExportOrigin = { version: 1, origin: "mizyun_user_entered" };
const options: HealthExportProjectionOptions = {
  clientId,
  revision: 1,
  confirmation: {
    schemaVersion: 1,
    recordId: id,
    savedUpdatedAt: updatedAt,
    origin: "mizyun_user_entered",
    rights: "first_party",
    derivedFrom: [],
    timeBasis: "observed",
  },
};
const food: HealthNutritionExportSource = {
  id,
  updatedAt,
  source: "manual",
  details: {},
  confirmedByUser: true,
  consumedAt: "2026-10-06T10:00:00.123Z",
  caloriesKcal: 0,
  proteinG: null,
  carbohydrateG: 12.5,
  fatG: 2,
};
const workout: HealthWorkoutExportSource = {
  id,
  updatedAt,
  source: "manual",
  details: { healthExportOrigin, workoutLifecycle: { kind: "session" } },
  startedAt: "2026-10-06T09:00:00.123Z",
  completedAt: "2026-10-06T09:30:00.456Z",
};
const unsafe = (value: unknown): HealthExportProjectionOptions =>
  value as HealthExportProjectionOptions;
describe("selected outbound health projections", () => {
  it("keeps actual times and nullable nutrients while selecting only export fields", () => {
    const source = {
      ...food,
      name: "Synthetic private name",
      userId: id,
      photo: "synthetic photo",
      sodiumMg: 12,
      confidence: 0.5,
    };
    const projected = projectHealthNutritionExport(source, options);
    expect(projected).toEqual({
      type: "upsert",
      category: "nutrition",
      clientId,
      revision: 1,
      nutrition: {
        consumedAt: food.consumedAt,
        energyKcal: 0,
        proteinG: null,
        carbsG: 12.5,
        fatG: 2,
      },
    });
    expect(healthExportPayloadSchema.parse(projected)).toEqual(projected);
    expect(JSON.stringify(projected)).not.toContain(id);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected?.nutrition)).toBe(true);
    expect(source).toMatchObject({
      name: "Synthetic private name",
      sodiumMg: 12,
    });
  });
  it("requires a saved receipt for the exact record revision, beyond manual/confirmed flags", () => {
    for (const confirmation of [
      null,
      {},
      { ...options.confirmation, recordId: clientId },
      { ...options.confirmation, savedUpdatedAt: "2026-10-06T12:00:01Z" },
    ]) {
      expect(
        projectHealthNutritionExport(
          food,
          unsafe({ ...options, confirmation }),
        ),
      ).toBeNull();
    }
    expect(
      projectHealthNutritionExport(
        { ...food, confirmedByUser: false },
        options,
      ),
    ).toBeNull();
    expect(
      projectHealthNutritionExport({ ...food, source: "imported" }, options),
    ).toBeNull();
  });
  it("rejects lineage relabeling, rights overrides and restricted derivative markers", () => {
    for (const patch of [
      { origin: "provider" },
      { origin: "community" },
      { origin: "ai" },
      { rights: "restricted" },
      { derivedFrom: ["imported"] },
      { allowedUses: ["export"] },
    ]) {
      expect(
        projectHealthNutritionExport(
          food,
          unsafe({
            ...options,
            confirmation: { ...options.confirmation, ...patch },
          }),
        ),
      ).toBeNull();
    }
    for (const details of [
      { origin: "manual", imported: true },
      { aiEstimate: true },
      { lineage: [] },
      { communityRecipeId: id },
      { restricted: true },
      { unknownMetadata: true },
    ]) {
      expect(
        projectHealthNutritionExport({ ...food, details }, options),
      ).toBeNull();
      expect(
        projectHealthWorkoutExport({ ...workout, details }, options),
      ).toBeNull();
    }
  });
  it("does not fabricate actual observation times for date-only logging", () => {
    const dateOnly = {
      ...options,
      confirmation: {
        ...options.confirmation,
        timeBasis: "date_only" as const,
      },
    };
    expect(projectHealthNutritionExport(food, dateOnly)).toBeNull();
    expect(projectHealthWorkoutExport(workout, dateOnly)).toBeNull();
    for (const consumedAt of [
      "2026-10-06",
      "2026-02-30T12:00:00Z",
      "2026-10-06T12:00:00+02:00",
    ]) {
      expect(
        projectHealthNutritionExport({ ...food, consumedAt }, options),
      ).toBeNull();
    }
  });
  it("accepts known manual display metadata but never exports its content", () => {
    const details = {
      grams: 150,
      mealDescription: "Synthetic manual description",
      mealGroup: { id: "synthetic-group", name: "Synthetic group" },
      mealGroupId: "synthetic-group",
      mealGroupName: "Synthetic group",
    };
    expect(hasEligibleHealthNutritionDetails(details)).toBe(true);
    const projected = projectHealthNutritionExport(
      { ...food, details },
      options,
    );
    expect(projected).not.toBeNull();
    expect(JSON.stringify(projected)).not.toContain("Synthetic");
    const sessionDetails = {
      healthExportOrigin,
      workoutLifecycle: { kind: "session" },
      sessionMode: "one_time",
      sessionExercises: [
        {
          name: "Synthetic exercise",
          catalogId: "synthetic-id",
          restSeconds: 90,
        },
      ],
    };
    expect(hasEligibleHealthWorkoutDetails(sessionDetails)).toBe(true);
    const summary = projectHealthWorkoutExport(
      { ...workout, details: sessionDetails },
      options,
    );
    expect(summary).not.toBeNull();
    expect(JSON.stringify(summary)).not.toContain("Synthetic");
    expect(
      hasEligibleHealthWorkoutDetails({
        healthExportOrigin,
        workoutLifecycle: { kind: "session" },
      }),
    ).toBe(true);
  });
  it("excludes routine/AI sessions and nested lineage even when their top level is manual", () => {
    for (const details of [{}, { workoutLifecycle: { kind: "session" } }]) {
      expect(hasEligibleHealthWorkoutDetails(details)).toBe(false);
      expect(
        projectHealthWorkoutExport({ ...workout, details }, options),
      ).toBeNull();
    }
    for (const details of [
      { workoutLifecycle: { kind: "routine" } },
      { workoutLifecycle: { kind: "session", routineId: id } },
      { workoutLifecycle: { kind: "session" }, coachPlan: {} },
      { sessionExercises: [{ name: "Synthetic exercise", imported: true }] },
      {
        sessionExercises: [
          { name: "Synthetic exercise", catalogId: id, providerData: {} },
        ],
      },
      { sessionMode: "ai" },
    ]) {
      expect(hasEligibleHealthWorkoutDetails(details)).toBe(false);
      expect(
        hasEligibleHealthWorkoutDetails({ healthExportOrigin, ...details }),
      ).toBe(false);
      expect(
        projectHealthWorkoutExport({ ...workout, details }, options),
      ).toBeNull();
    }
    for (const details of [
      { grams: NaN },
      { grams: 0 },
      { grams: "150" },
      { mealGroup: { id: "synthetic", name: "Synthetic", imported: true } },
      { mealDescription: { origin: "ai" } },
    ])
      expect(hasEligibleHealthNutritionDetails(details)).toBe(false);
  });
  it("preserves partial nutrients and rejects empty/invalid numeric input", () => {
    const knownZero = {
      ...food,
      caloriesKcal: null,
      carbohydrateG: null,
      fatG: 0,
    };
    expect(
      projectHealthNutritionExport(knownZero, options)?.nutrition,
    ).toMatchObject({
      energyKcal: null,
      proteinG: null,
      carbsG: null,
      fatG: 0,
    });
    expect(
      projectHealthNutritionExport({ ...knownZero, fatG: null }, options),
    ).toBeNull();
    for (const value of [undefined, NaN, Infinity, -1, 20_001]) {
      expect(
        projectHealthNutritionExport(
          { ...food, caloriesKcal: value } as HealthNutritionExportSource,
          options,
        ),
      ).toBeNull();
    }
  });
  it("uses only actual completed workout intervals with no names/sets/energy", () => {
    const projected = projectHealthWorkoutExport(
      {
        ...workout,
        name: "Synthetic catalog",
        sets: [],
        activeEnergyKcal: 500,
      } as HealthWorkoutExportSource,
      options,
    );
    expect(projected).toEqual({
      type: "upsert",
      category: "workout",
      clientId,
      revision: 1,
      workout: { startedAt: workout.startedAt, endedAt: workout.completedAt },
    });
    expect(healthExportPayloadSchema.parse(projected)).toEqual(projected);
    for (const completedAt of [
      null,
      workout.startedAt,
      "2026-10-06T08:00:00Z",
      "2026-10-07T09:00:01Z",
    ]) {
      expect(
        projectHealthWorkoutExport({ ...workout, completedAt }, options),
      ).toBeNull();
    }
  });
  it("retries keep identity, edits advance revision, and deletion retains interval without mutating earlier jobs", () => {
    const first = projectHealthNutritionExport(food, options)!;
    const retry = projectHealthNutritionExport({ ...food }, options)!;
    expect(retry).toEqual(first);
    expect(canReplaceHealthExport(first, retry)).toBe(false);
    const next = projectHealthNutritionExport(food, {
      ...options,
      revision: 2,
    })!;
    expect(canReplaceHealthExport(first, next)).toBe(true);
    expect(canReplaceHealthExport(next, first)).toBe(false);
    expect(canReplaceHealthExport(first, { ...next, clientId: id })).toBe(
      false,
    );
    const deletion = projectHealthExportDeletion(first, 2);
    expect(deletion).toEqual({ ...first, type: "delete", revision: 2 });
    expect(healthExportPayloadSchema.parse(deletion)).toEqual(deletion);
    expect(first.type).toBe("upsert");
    expect(projectHealthExportDeletion(first, 1)).toBeNull();
    expect(
      projectHealthExportDeletion(
        {
          ...first,
          nutrition: { ...first.nutrition, photo: "synthetic" },
        } as typeof first,
        2,
      ),
    ).toBeNull();
  });
  it("fails closed on malformed native payloads and matches the strict contract", () => {
    const first = projectHealthNutritionExport(food, options)!;
    const bad = [
      null,
      {},
      { ...first, userId: id },
      { ...first, category: "weight" },
      { ...first, revision: 0 },
      { ...first, clientId: "bad" },
      { ...first, nutrition: { ...first.nutrition, fatG: NaN } },
    ];
    for (const candidate of [
      first,
      projectHealthWorkoutExport(workout, options),
      ...bad,
    ]) {
      expect(isHealthExportPayload(candidate)).toBe(
        healthExportPayloadSchema.safeParse(candidate).success,
      );
    }
  });
  it("bounds monotonic revisions without overflow", () => {
    expect(nextHealthExportRevision(0)).toBe(1);
    expect(nextHealthExportRevision(1)).toBe(2);
    expect(nextHealthExportRevision(Number.MAX_SAFE_INTEGER - 1)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    for (const previous of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
      expect(nextHealthExportRevision(previous)).toBeNull();
    for (const revision of [
      0,
      1.1,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(
        projectHealthNutritionExport(food, { ...options, revision }),
      ).toBeNull();
    }
  });
});
