import { describe, expect, it, vi } from "vitest";

import {
  CalorieAdjustmentRepositoryError,
  goalModeFor,
  type CalorieReview,
  type UserId,
} from "@mizyun/core";

import { SupabaseCalorieAdjustmentRepository } from "./calorie-adjustment-repository.js";
import type { RepositorySupabaseClient } from "./index.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;
const goalId = "00000000-0000-4000-8000-00000000b001";
const proposalId = "00000000-0000-4000-8000-00000000c001";

const review: CalorieReview = {
  version: "v1-2026-10",
  computedAt: new Date("2026-10-15T08:00:00.000Z"),
  status: "adjust",
  reasons: ["below_band"],
  method: "rate_error",
  goalMode: goalModeFor("cut", "steady"),
  goalAgeDays: 30,
  observedWeeklyPercent: -0.1,
  observedWeeklyChangeKg: -0.08,
  smoothedWeightKg: 80,
  loggedDays: 6,
  averageIntakeKcal: 2000,
  adherencePercent: 100,
  adaptiveMaintenanceKcal: null,
  currentTargetKcal: 2000,
  proposedTargetKcal: 1800,
  deltaKcal: -200,
  targetChangeKcal: -200,
  calibrationBeforeKcal: 0,
  calibrationAfterKcal: -200,
};

const row = (overrides: Record<string, unknown> = {}) => ({
  id: proposalId,
  user_id: userId,
  goal_id: goalId,
  week_start: "2026-10-12",
  goal_pace: "steady",
  status: "pending",
  review: { ...review, computedAt: review.computedAt.toISOString() },
  current_target_kcal: 2000,
  proposed_target_kcal: 1800,
  delta_kcal: -200,
  calibration_before_kcal: 0,
  calibration_after_kcal: -200,
  created_at: "2026-10-15T08:00:00.000Z",
  decided_at: null,
  ...overrides,
});

const clientWith = (handlers: {
  single?: () => unknown;
  maybeSingle?: () => unknown;
  rpc?: (name: string, args: Record<string, unknown>) => unknown;
  onInsert?: (payload: unknown) => void;
}): RepositorySupabaseClient => {
  const calls: Array<[string, unknown[]]> = [];
  return {
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq", "order", "limit"]) {
        builder[method] = vi.fn((...args: unknown[]) => {
          calls.push([method, args]);
          return builder;
        });
      }
      builder.insert = vi.fn((payload: unknown) => {
        handlers.onInsert?.(payload);
        return builder;
      });
      builder.single = vi.fn(async () => handlers.single?.());
      builder.maybeSingle = vi.fn(async () => handlers.maybeSingle?.());
      return builder;
    },
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) =>
      handlers.rpc?.(name, args),
    ),
    auth: { setSession: vi.fn() },
    calls,
  } as unknown as RepositorySupabaseClient;
};

describe("SupabaseCalorieAdjustmentRepository", () => {
  it("stores the frozen review and maps the row back", async () => {
    let inserted: Record<string, unknown> | undefined;
    const repo = new SupabaseCalorieAdjustmentRepository({
      clientFor: () =>
        clientWith({
          onInsert: (payload) => {
            inserted = payload as Record<string, unknown>;
          },
          single: () => ({ data: row(), error: null }),
        }),
    });
    const stored = await repo.create(
      {
        id: proposalId,
        userId,
        goalId,
        weekStart: "2026-10-12",
        goalPace: "steady",
        review,
      },
      { accessToken: "token" },
    );
    expect(inserted).toMatchObject({
      goal_pace: "steady",
      status: "pending",
      delta_kcal: -200,
      calibration_before_kcal: 0,
      calibration_after_kcal: -200,
      proposed_target_kcal: 1800,
    });
    expect((inserted?.review as Record<string, unknown>).computedAt).toBe(
      "2026-10-15T08:00:00.000Z",
    );
    expect(stored.review.computedAt).toEqual(review.computedAt);
    expect(stored.status).toBe("pending");
  });

  it("returns the existing row when a concurrent insert won the week", async () => {
    const repo = new SupabaseCalorieAdjustmentRepository({
      clientFor: () =>
        clientWith({
          single: () => ({
            data: null,
            error: { code: "23505", message: "duplicate key value" },
          }),
          maybeSingle: () => ({ data: row({ id: "winner" }), error: null }),
        }),
    });
    const stored = await repo.create(
      {
        id: proposalId,
        userId,
        goalId,
        weekStart: "2026-10-12",
        goalPace: "steady",
        review,
      },
      { accessToken: "token" },
    );
    expect(stored.id).toBe("winner");
  });

  it("reads this week's live proposal, ignoring superseded rows", async () => {
    const client = clientWith({
      maybeSingle: () => ({ data: row(), error: null }),
    });
    const repo = new SupabaseCalorieAdjustmentRepository({
      clientFor: () => client,
    });
    const stored = await repo.getForWeek(userId, goalId, "2026-10-12", {
      accessToken: "token",
    });
    expect(stored?.goalPace).toBe("steady");
    const calls = (client as unknown as { calls: Array<[string, unknown[]]> })
      .calls;
    expect(calls).toContainEqual(["neq", ["status", "superseded"]]);
  });

  it("reads the latest accepted decision time for the cooldown", async () => {
    const client = clientWith({
      maybeSingle: () => ({
        data: { decided_at: "2026-10-10T09:00:00.000Z" },
        error: null,
      }),
    });
    const repo = new SupabaseCalorieAdjustmentRepository({
      clientFor: () => client,
    });
    await expect(
      repo.getLastAcceptedAt(userId, goalId, { accessToken: "token" }),
    ).resolves.toEqual(new Date("2026-10-10T09:00:00.000Z"));
    const calls = (client as unknown as { calls: Array<[string, unknown[]]> })
      .calls;
    expect(calls).toContainEqual(["eq", ["status", "accepted"]]);
    expect(calls).toContainEqual([
      "order",
      ["decided_at", { ascending: false }],
    ]);
    const empty = new SupabaseCalorieAdjustmentRepository({
      clientFor: () =>
        clientWith({ maybeSingle: () => ({ data: null, error: null }) }),
    });
    await expect(
      empty.getLastAcceptedAt(userId, goalId, { accessToken: "token" }),
    ).resolves.toBeNull();
  });

  it("rejects a non-adjust review before writing", async () => {
    const onInsert = vi.fn();
    const repo = new SupabaseCalorieAdjustmentRepository({
      clientFor: () => clientWith({ onInsert }),
    });
    await expect(
      repo.create(
        {
          id: proposalId,
          userId,
          goalId,
          weekStart: "2026-10-12",
          goalPace: "steady",
          review: { ...review, status: "hold", deltaKcal: 0 },
        },
        { accessToken: "token" },
      ),
    ).rejects.toBeInstanceOf(CalorieAdjustmentRepositoryError);
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("decides through the owner-scoped RPC and maps its errors", async () => {
    const rpc = vi.fn((_name: string, args: Record<string, unknown>) =>
      args.p_proposal_id === proposalId
        ? {
            data: [
              row({
                status: "accepted",
                decided_at: "2026-10-15T09:00:00.000Z",
              }),
            ],
            error: null,
          }
        : args.p_proposal_id === "decided"
          ? {
              data: [],
              error: {
                code: "55000",
                message: "calorie_adjustment_already_decided",
              },
            }
          : {
              data: [],
              error: { code: "P0002", message: "calorie_adjustment_not_found" },
            },
    );
    const repo = new SupabaseCalorieAdjustmentRepository({
      clientFor: () => clientWith({ rpc }),
    });
    const accepted = await repo.decide(userId, proposalId, "accept", {
      accessToken: "token",
    });
    expect(accepted.status).toBe("accepted");
    expect(rpc).toHaveBeenCalledWith("decide_calorie_adjustment", {
      p_proposal_id: proposalId,
      p_decision: "accept",
    });
    await expect(
      repo.decide(userId, "decided", "accept", { accessToken: "token" }),
    ).rejects.toMatchObject({ kind: "already_decided" });
    await expect(
      repo.decide(userId, "other", "decline", { accessToken: "token" }),
    ).rejects.toMatchObject({ kind: "not_found" });
  });
});
