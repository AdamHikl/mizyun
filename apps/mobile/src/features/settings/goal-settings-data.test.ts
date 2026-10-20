import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 12));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("converts goal to metric form values", () => {
    const form = goalSettingsFormFromGoal(mockGoal, "metric");
    expect(form).toEqual({
      kind: "cut",
      targetWeight: "75.5",
      pace: "steady",
      targetDate: "2026-11-01",
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
      targetDate: null,
    });
  });

  it("validates valid metric target weight", () => {
    const validation = validateGoalSettingsForm(
      {
        kind: "cut",
        targetWeight: "72.0",
        pace: "steady",
        targetDate: null,
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
        targetDate: null,
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
        targetDate: null,
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
        targetDate: "2026-11-01",
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
        targetDate: null,
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
    // No invented deadline: the new goal has no target date.
    expect(request.mock.calls[1]?.[0].body).not.toHaveProperty("targetDate");
  });

  it("asks for a new date when the stored target date has passed", () => {
    const validation = validateGoalSettingsForm(
      {
        kind: "bulk",
        targetWeight: "80",
        pace: "steady",
        targetDate: "2026-10-19",
      },
      "metric",
    );
    expect(validation).toEqual({
      ok: false,
      message: "Your target date has passed. Choose a new date or remove it.",
    });
    // Today is still a valid deadline.
    expect(
      validateGoalSettingsForm(
        {
          kind: "bulk",
          targetWeight: "80",
          pace: "steady",
          targetDate: "2026-10-20",
        },
        "metric",
      ).ok,
    ).toBe(true);
  });

  it("keeps a passed stored date from blocking a pace change, but not a new goal", async () => {
    const pastGoal: Goal = { ...mockGoal, targetDate: "2026-10-01" };
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { goal: pastGoal } });
    const client = { request } as unknown as ApiClient;

    const update = await saveGoalSettings(
      client,
      pastGoal,
      {
        kind: "cut",
        targetWeight: "75.5",
        pace: "aggressive",
        targetDate: "2026-10-01",
      },
      "metric",
    );
    expect(update.ok).toBe(true);
    expect(request.mock.calls[0]?.[0].body).toEqual({
      target: { weightKg: 75.5 },
      pace: "aggressive",
    });

    // A kind change creates a goal starting today, so the old date can't carry over.
    const create = await saveGoalSettings(
      client,
      pastGoal,
      {
        kind: "bulk",
        targetWeight: "80",
        pace: "steady",
        targetDate: "2026-10-01",
      },
      "metric",
    );
    expect(create).toEqual({
      ok: false,
      message: "Your target date has passed. Choose a new date or remove it.",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("clears or changes the stored target date on update", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { goal: mockGoal } });
    const client = { request } as unknown as ApiClient;
    const form = { kind: "cut", targetWeight: "75.5", pace: "steady" } as const;

    await saveGoalSettings(
      client,
      mockGoal,
      { ...form, targetDate: null },
      "metric",
    );
    await saveGoalSettings(
      client,
      mockGoal,
      { ...form, targetDate: "2027-01-15" },
      "metric",
    );

    expect(request.mock.calls[0]?.[0].body).toEqual({
      target: { weightKg: 75.5 },
      pace: "steady",
      targetDate: null,
    });
    expect(request.mock.calls[1]?.[0].body).toEqual({
      target: { weightKg: 75.5 },
      pace: "steady",
      targetDate: "2027-01-15",
    });
  });

  it("sends a chosen date on create but never one for maintain", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { goal: mockGoal } });
    const client = { request } as unknown as ApiClient;

    await saveGoalSettings(
      client,
      null,
      {
        kind: "bulk",
        targetWeight: "80",
        pace: "steady",
        targetDate: "2027-02-01",
      },
      "metric",
    );
    await saveGoalSettings(
      client,
      null,
      {
        kind: "maintain",
        targetWeight: "80",
        pace: "steady",
        targetDate: "2027-02-01",
      },
      "metric",
    );

    expect(request.mock.calls[0]?.[0].body).toMatchObject({
      kind: "bulk",
      startsOn: "2026-10-20",
      targetDate: "2027-02-01",
    });
    expect(request.mock.calls[1]?.[0].body).not.toHaveProperty("targetDate");
  });
});
