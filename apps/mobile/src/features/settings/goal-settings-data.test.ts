import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import type { Goal } from "@mizyun/contracts";

import {
  goalSettingsFormFromGoal,
  loadActiveGoal,
  saveGoalSettings,
  validateGoalSettingsForm,
} from "./goal-settings-data";

const mockGoal: Goal = {
  id: "00000000-0000-4000-8000-000000000010",
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "cut",
  status: "active",
  pace: "steady",
  target: {
    weightKg: 75.5,
  },
  startsOn: "2026-08-01",
  targetDate: "2026-11-01",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("goal-settings-data", () => {
  it("converts goal to metric form values", () => {
    const form = goalSettingsFormFromGoal(mockGoal, "metric");
    expect(form).toEqual({
      kind: "cut",
      targetWeight: "75.5",
      pace: "steady",
    });
  });

  it("converts goal to imperial form values", () => {
    const form = goalSettingsFormFromGoal(mockGoal, "imperial");
    // 75.5 * 2.2046226218 = ~166.5
    expect(Number(form.targetWeight)).toBeCloseTo(166.5, 0);
  });

  it("handles null goal gracefully", () => {
    const form = goalSettingsFormFromGoal(null, "metric");
    expect(form).toEqual({
      kind: "cut",
      targetWeight: "",
      pace: "steady",
    });
  });

  it("validates valid metric target weight", () => {
    const validation = validateGoalSettingsForm(
      {
        kind: "cut",
        targetWeight: "72.0",
        pace: "steady",
      },
      "metric",
    );
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.targetWeightKg).toBe(72.0);
    }
  });

  it("rejects invalid target weight", () => {
    const validation = validateGoalSettingsForm(
      {
        kind: "cut",
        targetWeight: "abc",
        pace: "steady",
      },
      "metric",
    );
    expect(validation.ok).toBe(false);
  });

  it("rejects out-of-range target weight", () => {
    const validation = validateGoalSettingsForm(
      {
        kind: "cut",
        targetWeight: "15.0",
        pace: "steady",
      },
      "metric",
    );
    expect(validation.ok).toBe(false);
  });

  it("updates existing active goal when kind is unchanged", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        goal: {
          ...mockGoal,
          target: { weightKg: 73.0 },
        },
      },
    });
    const client = { request } as unknown as ApiClient;

    const result = await saveGoalSettings(
      client,
      mockGoal,
      {
        kind: "cut",
        targetWeight: "73.0",
        pace: "steady",
      },
      "metric",
    );

    expect(result.ok).toBe(true);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: `/v1/goals/${mockGoal.id}`,
        body: { target: { weightKg: 73.0 }, pace: "steady" },
      }),
    );
  });

  it("archives and creates new goal when kind changes", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { goal: mockGoal } })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          goal: {
            ...mockGoal,
            id: "00000000-0000-4000-8000-000000000020",
            kind: "bulk",
            target: { weightKg: 80.0 },
          },
        },
      });
    const client = { request } as unknown as ApiClient;

    const result = await saveGoalSettings(
      client,
      mockGoal,
      {
        kind: "bulk",
        targetWeight: "80.0",
        pace: "steady",
      },
      "metric",
    );

    expect(result.ok).toBe(true);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: `/v1/goals/${mockGoal.id}`,
        body: { status: "archived" },
      }),
    );
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/v1/goals",
        body: expect.objectContaining({
          kind: "bulk",
          target: { weightKg: 80.0 },
        }),
      }),
    );
  });
});
