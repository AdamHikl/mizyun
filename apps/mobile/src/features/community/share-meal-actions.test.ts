import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import type { MealSharePreviewDto } from "@mizyun/contracts";
import { saveMealShare } from "./share-meal-actions";

const preview: MealSharePreviewDto = {
  mealId: "10000000-0000-4000-8000-000000000001",
  enrollmentGeneration: 3,
  existingActivity: null,
  sharedDay: "2026-10-12",
  mealDetails: {
    name: "Oatmeal",
    caloriesKcal: 360,
    proteinG: 12,
    carbsG: 60,
    fatG: null,
  },
  followerCount: 1,
};
const intent = {
  mealId: preview.mealId,
  preview,
  includeNutrition: false,
  operationId: "00000000-0000-4000-8000-000000000001",
  enrollmentGeneration: 3,
};

describe("deliberate meal publication", () => {
  it("allowlists the name and selected day while omitting all private source fields and unselected nutrition", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, value: {} });
    await saveMealShare({ request } as unknown as ApiClient, {
      ...intent,
      preview: {
        ...preview,
        mealDetails: {
          ...preview.mealDetails,
          notes: "private",
          photoAssetId: "private",
          aiMetadata: "private",
        } as any,
      },
    });
    expect(request.mock.calls[0]![0]).toMatchObject({
      method: "POST",
      path: "/v1/community/meal-activities",
      body: {
        mealId: preview.mealId,
        sharedDay: preview.sharedDay,
        includeNutrition: false,
        expectedMealDetails: {
          name: "Oatmeal",
          caloriesKcal: null,
          proteinG: null,
          carbsG: null,
          fatG: null,
        },
        operationId: intent.operationId,
        enrollmentGeneration: 3,
        expectedVersion: 0,
        expectedRevoked: false,
      },
    });
    expect(
      Object.keys(request.mock.calls[0]![0].body.expectedMealDetails),
    ).toEqual(["name", "caloriesKcal", "proteinG", "carbsG", "fatG"]);
  });
  it("preserves the exact projection and immutable operation across a lost-response retry", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { kind: "network_error" } })
      .mockResolvedValueOnce({ ok: true, value: {} });
    const input = { ...intent, includeNutrition: true };
    await saveMealShare({ request } as unknown as ApiClient, input);
    await saveMealShare({ request } as unknown as ApiClient, input);
    expect(request.mock.calls[0]![0].body).toEqual(
      request.mock.calls[1]![0].body,
    );
    expect(request.mock.calls[0]![0].body.expectedMealDetails).toEqual(
      preview.mealDetails,
    );
  });
  it.each([
    { ...intent, mealId: "another-meal" },
    { ...intent, enrollmentGeneration: 4 },
    { ...intent, existingActivityId: "another-card" },
  ])(
    "rejects mismatched meal, enrollment or existing-card previews before any request",
    async (input) => {
      const request = vi.fn();
      expect(
        (await saveMealShare({ request } as unknown as ApiClient, input)).ok,
      ).toBe(false);
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("uses the preview version and revoked state when explicitly sharing again", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, value: {} });
    await saveMealShare({ request } as unknown as ApiClient, {
      ...intent,
      preview: {
        ...preview,
        existingActivity: {
          id: "card",
          version: 4,
          revokedAt: "2026-10-12T00:00:00Z",
        } as any,
      },
    });
    expect(request.mock.calls[0]![0].body).toMatchObject({
      expectedVersion: 4,
      expectedRevoked: true,
    });
  });
});
