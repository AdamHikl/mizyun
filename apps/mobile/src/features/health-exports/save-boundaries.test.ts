import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import {
  submitLogMealWith,
  type LogMealForm,
} from "@/features/log-meal/log-meal-data";
import { completeWorkoutWith } from "@/features/log-workout/log-workout-data";
import { updateFoodEntryWith } from "@/features/log-meal/meal-lifecycle-data";
const saved = { id: "00000000-0000-4000-8000-000000000002" };
const form: LogMealForm = {
  clientOperationId: "00000000-0000-4000-8000-000000000003",
  name: "Meal",
  caloriesKcal: 100,
  proteinG: null,
  carbohydrateG: null,
  fatG: null,
  consumedAt: "2026-10-06T10:00:00Z",
  healthExportFirstParty: true,
  healthExportTimeBasis: "observed",
};
const client = (ok: boolean) =>
  ({
    request: vi.fn(async () =>
      ok
        ? { ok: true, value: { foodEntry: saved, workout: saved } }
        : { ok: false, error: { kind: "network_error" } },
    ),
  }) as unknown as ApiClient;
describe("save-first health export boundary", () => {
  it("meal create and edit remain successful when optional export throws", async () => {
    const api = client(true);
    const fail = () => {
      throw new Error("health unavailable");
    };
    expect(await submitLogMealWith(form, api, () => new Date(), fail)).toEqual({
      ok: true,
      id: saved.id,
    });
    expect(await updateFoodEntryWith(api, saved.id, form, fail)).toEqual({
      ok: true,
      id: saved.id,
    });
    expect(vi.mocked(api.request).mock.calls[0][0].body).not.toHaveProperty(
      "healthExportFirstParty",
    );
    expect(vi.mocked(api.request).mock.calls[0][0].body).not.toHaveProperty(
      "healthExportTimeBasis",
    );
  });
  it("workout completion remains successful when optional export throws", async () => {
    expect(
      await completeWorkoutWith(
        client(true),
        saved.id,
        () => new Date(),
        undefined,
        () => {
          throw new Error("write denied");
        },
      ),
    ).toEqual({ ok: true });
  });
  it("failed Mizyun mutations never produce export receipts", async () => {
    const afterSave = vi.fn();
    await submitLogMealWith(form, client(false), () => new Date(), afterSave);
    await updateFoodEntryWith(client(false), saved.id, form, afterSave);
    await completeWorkoutWith(
      client(false),
      saved.id,
      () => new Date(),
      undefined,
      afterSave,
    );
    expect(afterSave).not.toHaveBeenCalled();
  });
});
