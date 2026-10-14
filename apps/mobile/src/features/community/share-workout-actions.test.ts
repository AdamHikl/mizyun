import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import { saveWorkoutShare } from "./share-workout-actions";

const intent = {
  operationId: "00000000-0000-4000-8000-000000000001",
  enrollmentGeneration: 1,
};
const preview = {
  workoutId: "workout-a",
  category: "strength" as const,
  sharedDay: "2026-09-01",
  durationSeconds: 1234,
  workoutDetails: null,
  activityKind: "workout",
  mealDetails: null,
  followerCount: 3,
  enrollmentGeneration: 1,
};

describe("workout sharing boundary", () => {
  it("confirms a new version explicitly with a durable operation when removing duration", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, value: {} });
    await saveWorkoutShare({ request } as unknown as ApiClient, {
      ...intent,
      workoutId: preview.workoutId,
      preview,
      includeDuration: false,
      existingActivityId: "card-a",
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/v1/community/activities",
        body: expect.objectContaining({ ...intent, includeDuration: false }),
      }),
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("never publishes a selected workout with a stale preview for another workout", async () => {
    const request = vi.fn();
    const result = await saveWorkoutShare({ request } as unknown as ApiClient, {
      ...intent,
      workoutId: "workout-b",
      preview,
      includeDuration: true,
    });
    expect(result.ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
  it("publishes the exact date-only day confirmed by the preview", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, value: {} });
    await saveWorkoutShare({ request } as unknown as ApiClient, {
      ...intent,
      workoutId: preview.workoutId,
      preview,
      includeDuration: true,
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        body: {
          ...intent,
          workoutId: "workout-a",
          category: "strength",
          sharedDay: "2026-09-01",
          includeDuration: true,
          includeWorkoutDetails: false,
          expectedDurationSeconds: 1234,
          expectedVersion: 0,
          expectedRevoked: false,
        },
      }),
    );
  });
  it("uses the existing preview card when the parent has not supplied its ID", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, value: {} });
    await saveWorkoutShare({ request } as unknown as ApiClient, {
      ...intent,
      workoutId: preview.workoutId,
      includeDuration: false,
      preview: {
        ...preview,
        existingActivity: {
          id: "30000000-0000-4000-8000-000000000001",
          authorUserId: "00000000-0000-4000-8000-000000000001",
          authorHandle: "alice",
          authorDisplayName: "Alice",
          authorAvatarSymbol: "AL",
          category: "strength",
          sharedDay: "2026-09-01",
          durationSeconds: 1234,
          workoutDetails: null,
          activityKind: "workout",
          mealDetails: null,
          publishedAt: "2026-09-01T12:00:00Z",
          reactionCounts: {},
          viewerReaction: null,
          sourceMealId: null,
          sourceWorkoutId: "10000000-0000-4000-8000-000000000001",
          version: 1,
          revokedAt: null,
        },
      },
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/v1/community/activities",
        body: expect.objectContaining({ ...intent, includeDuration: false }),
      }),
    );
  });
});

const workoutDetails = {
  exercises: [
    {
      name: "Squat",
      sets: [
        {
          setType: "normal" as const,
          repetitions: 8,
          loadKg: 60,
          durationSeconds: null,
        },
      ],
    },
  ],
};
describe("explicit detailed publication", () => {
  it("does not send private details until selected", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, value: {} });
    await saveWorkoutShare({ request } as unknown as ApiClient, {
      ...intent,
      workoutId: preview.workoutId,
      preview: { ...preview, workoutDetails },
      includeDuration: false,
    });
    const body = request.mock.calls[0]![0].body;
    expect(body.includeWorkoutDetails).toBe(false);
    expect(body).not.toHaveProperty("expectedWorkoutDetails");
  });
  it("retains the exact confirmed projection and operation across a lost-response retry", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { kind: "network_error" } })
      .mockResolvedValueOnce({ ok: true, value: {} });
    const input = {
      ...intent,
      workoutId: preview.workoutId,
      preview: { ...preview, workoutDetails },
      includeDuration: false,
      includeWorkoutDetails: true,
    };
    await saveWorkoutShare({ request } as unknown as ApiClient, input);
    await saveWorkoutShare({ request } as unknown as ApiClient, input);
    expect(request.mock.calls[0]![0].body).toEqual(
      request.mock.calls[1]![0].body,
    );
    expect(request.mock.calls[0]![0].body).toMatchObject({
      includeWorkoutDetails: true,
      expectedWorkoutDetails: workoutDetails,
      operationId: intent.operationId,
    });
  });
  it("refuses a missing detail preview instead of silently sharing a different projection", async () => {
    const request = vi.fn();
    const result = await saveWorkoutShare({ request } as unknown as ApiClient, {
      ...intent,
      workoutId: preview.workoutId,
      preview: { ...preview, workoutDetails: null },
      includeDuration: false,
      includeWorkoutDetails: true,
    });
    expect(result.ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});
