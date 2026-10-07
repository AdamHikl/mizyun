import { describe, expect, it } from "vitest";
import {
  healthExportConfirmationSchema,
  healthExportPayloadSchema,
  healthExportRevisionSchema,
} from "./health-export";
const clientId = "00000000-0000-4000-8000-000000000001";
const nutrition = {
  type: "upsert",
  category: "nutrition",
  clientId,
  revision: 1,
  nutrition: {
    consumedAt: "2026-10-06T12:00:00.000Z",
    energyKcal: 0,
    proteinG: null,
    carbsG: 2.25,
    fatG: null,
  },
};
const workout = {
  type: "upsert",
  category: "workout",
  clientId,
  revision: 1,
  workout: {
    startedAt: "2026-10-06T12:00:00.123Z",
    endedAt: "2026-10-06T12:30:00.456Z",
  },
};
const confirmation = {
  schemaVersion: 1,
  recordId: clientId,
  savedUpdatedAt: "2026-10-06T12:00:00.000Z",
  origin: "mizyun_user_entered",
  rights: "first_party",
  derivedFrom: [],
  timeBasis: "observed",
};
describe("health export contracts", () => {
  it("preserves zero, fractional nutrients, unknown quantities and actual UTC times", () => {
    expect(healthExportPayloadSchema.parse(nutrition)).toEqual(nutrition);
    expect(healthExportPayloadSchema.parse(workout)).toEqual(workout);
    expect(
      healthExportPayloadSchema.parse({
        ...workout,
        type: "delete",
        revision: 2,
      }),
    ).toMatchObject({ type: "delete" });
  });
  it.each([NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects revision %s",
    (revision) => {
      expect(healthExportRevisionSchema.safeParse(revision).success).toBe(
        false,
      );
    },
  );
  it.each([
    "2026-02-30T12:00:00Z",
    "2026-10-06",
    "2026-10-06T12:00:00+02:00",
    "2026-10-06T24:00:00Z",
    "not-a-time",
  ])("rejects invented/noncanonical time %s", (consumedAt) => {
    expect(
      healthExportPayloadSchema.safeParse({
        ...nutrition,
        nutrition: { ...nutrition.nutrition, consumedAt },
      }).success,
    ).toBe(false);
  });
  it.each([NaN, Infinity, -1, 20_001])(
    "rejects invalid nutrition %s",
    (energyKcal) => {
      expect(
        healthExportPayloadSchema.safeParse({
          ...nutrition,
          nutrition: { ...nutrition.nutrition, energyKcal },
        }).success,
      ).toBe(false);
    },
  );
  it("does not export a nutrient record with every quantity unknown", () => {
    expect(
      healthExportPayloadSchema.safeParse({
        ...nutrition,
        nutrition: { ...nutrition.nutrition, energyKcal: null, carbsG: null },
      }).success,
    ).toBe(false);
  });
  it("rejects sensitive extras, unexpected categories and extra lineage assertions", () => {
    for (const extra of [
      { userId: clientId },
      { photo: "synthetic" },
      { sets: [] },
      { activeEnergyKcal: 4 },
      { weightKg: 70 },
      { allowedUses: ["export"] },
    ]) {
      expect(
        healthExportPayloadSchema.safeParse({ ...workout, ...extra }).success,
      ).toBe(false);
    }
    expect(
      healthExportPayloadSchema.safeParse({
        ...nutrition,
        nutrition: {
          ...nutrition.nutrition,
          name: "synthetic food",
          sodiumMg: 1,
        },
      }).success,
    ).toBe(false);
    expect(
      healthExportPayloadSchema.safeParse({ ...workout, category: "weight" })
        .success,
    ).toBe(false);
    expect(
      healthExportConfirmationSchema.safeParse({
        ...confirmation,
        allowedUses: ["export"],
      }).success,
    ).toBe(false);
  });
  it("requires untained first-party lineage even after confirmation", () => {
    expect(healthExportConfirmationSchema.parse(confirmation)).toEqual(
      confirmation,
    );
    for (const patch of [
      { origin: "imported" },
      { rights: "restricted" },
      { derivedFrom: ["imported"] },
    ]) {
      expect(
        healthExportConfirmationSchema.safeParse({ ...confirmation, ...patch })
          .success,
      ).toBe(false);
    }
  });
  it.each([
    "2026-10-06T11:59:59Z",
    "2026-10-06T12:00:00.123Z",
    "2026-10-07T12:00:01Z",
  ])("rejects invalid completed interval ending %s", (endedAt) => {
    expect(
      healthExportPayloadSchema.safeParse({
        ...workout,
        workout: { ...workout.workout, endedAt },
      }).success,
    ).toBe(false);
  });
});
