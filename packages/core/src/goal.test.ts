import { describe, expect, it } from "vitest";

import type { UserId } from "./index.js";
import {
  ALLOWED_STATUS_TRANSITIONS,
  applyGoalPatch,
  validateGoalCreate,
  validateGoalPatch,
  type StoredGoal,
} from "./goal.js";

const baseGoal = (overrides: Partial<StoredGoal> = {}): StoredGoal => ({
  id: "10000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000001" as UserId,
  kind: "cut",
  status: "active",
  pace: "steady",
  target: { weightKg: 80 },
  startsOn: "2026-01-01",
  targetDate: "2026-04-01",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("ALLOWED_STATUS_TRANSITIONS", () => {
  it("permits draft to active and draft to archived", () => {
    expect(ALLOWED_STATUS_TRANSITIONS.draft).toEqual(["active", "archived"]);
  });

  it("permits active to completed and active to archived", () => {
    expect(ALLOWED_STATUS_TRANSITIONS.active).toEqual([
      "completed",
      "archived",
    ]);
  });

  it("makes completed and archived terminal", () => {
    expect(ALLOWED_STATUS_TRANSITIONS.completed).toEqual([]);
    expect(ALLOWED_STATUS_TRANSITIONS.archived).toEqual([]);
  });
});

describe("validateGoalCreate", () => {
  it("accepts a minimal cut goal", () => {
    expect(
      validateGoalCreate({
        kind: "cut",
        pace: "steady",
        target: { weightKg: 80 },
        startsOn: "2026-01-01",
        targetDate: "2026-04-01",
      }),
    ).toBeNull();
  });

  it("accepts a recomp goal with body fat percent", () => {
    expect(
      validateGoalCreate({
        kind: "recomp",
        pace: "gradual",
        target: { weightKg: 80, bodyFatPercent: 15 },
        startsOn: "2026-01-01",
        targetDate: "2026-06-01",
      }),
    ).toBeNull();
  });

  it("rejects a target date before the start date", () => {
    expect(
      validateGoalCreate({
        kind: "cut",
        pace: "steady",
        target: { weightKg: 80 },
        startsOn: "2026-04-01",
        targetDate: "2026-01-01",
      }),
    ).toEqual({ kind: "target_date_before_start" });
  });

  it("rejects a review date before the start date", () => {
    expect(
      validateGoalCreate({
        kind: "cut",
        pace: "steady",
        target: { weightKg: 80 },
        startsOn: "2026-04-01",
        targetDate: "2026-07-01",
        reviewDate: "2026-01-01",
      }),
    ).toEqual({ kind: "review_date_before_start" });
  });

  it("rejects an out-of-range weight", () => {
    expect(
      validateGoalCreate({
        kind: "cut",
        pace: "steady",
        target: { weightKg: 10 },
        startsOn: "2026-01-01",
        targetDate: "2026-04-01",
      }),
    ).toEqual({ kind: "weight_out_of_range", min: 30, max: 250 });
    expect(
      validateGoalCreate({
        kind: "cut",
        pace: "steady",
        target: { weightKg: 400 },
        startsOn: "2026-01-01",
        targetDate: "2026-04-01",
      }),
    ).toEqual({ kind: "weight_out_of_range", min: 30, max: 250 });
  });

  it("rejects an out-of-range body fat percent", () => {
    expect(
      validateGoalCreate({
        kind: "recomp",
        pace: "steady",
        target: { weightKg: 80, bodyFatPercent: 90 },
        startsOn: "2026-01-01",
        targetDate: "2026-04-01",
      }),
    ).toEqual({ kind: "body_fat_out_of_range", min: 3, max: 60 });
  });

  it("rejects a malformed date", () => {
    expect(
      validateGoalCreate({
        kind: "cut",
        pace: "steady",
        target: { weightKg: 80 },
        startsOn: "not-a-date",
        targetDate: "2026-04-01",
      }),
    ).toEqual({ kind: "invalid_date_format", value: "not-a-date" });
  });
});

describe("validateGoalPatch", () => {
  it("rejects an empty patch", () => {
    expect(validateGoalPatch(baseGoal(), {})).toEqual({
      kind: "empty_patch",
    });
  });

  it("accepts a pace update on an active goal", () => {
    expect(validateGoalPatch(baseGoal(), { pace: "aggressive" })).toBeNull();
  });

  it("accepts a transition from active to completed", () => {
    expect(validateGoalPatch(baseGoal(), { status: "completed" })).toBeNull();
  });

  it("accepts a transition from active to archived", () => {
    expect(validateGoalPatch(baseGoal(), { status: "archived" })).toBeNull();
  });

  it("accepts a transition from draft to active", () => {
    expect(
      validateGoalPatch(baseGoal({ status: "draft" }), { status: "active" }),
    ).toBeNull();
  });

  it("rejects a transition from completed to active", () => {
    expect(
      validateGoalPatch(baseGoal({ status: "completed" }), {
        status: "active",
      }),
    ).toEqual({
      kind: "invalid_status_transition",
      from: "completed",
      to: "active",
    });
  });

  it("rejects a transition from archived to draft", () => {
    expect(
      validateGoalPatch(baseGoal({ status: "archived" }), { status: "draft" }),
    ).toEqual({
      kind: "invalid_status_transition",
      from: "archived",
      to: "draft",
    });
  });

  it("accepts a same-status patch (no-op transition)", () => {
    // No-op: keeping the same status is allowed even though it would
    // not normally be sent.
    expect(
      validateGoalPatch(baseGoal({ status: "active" }), { status: "active" }),
    ).toBeNull();
  });

  it("rejects a targetDate before the start date", () => {
    expect(validateGoalPatch(baseGoal(), { targetDate: "2025-12-01" })).toEqual(
      { kind: "target_date_before_start" },
    );
  });

  it("accepts clearing the review date via null", () => {
    expect(
      validateGoalPatch(baseGoal({ reviewDate: "2026-06-01" }), {
        reviewDate: null,
      }),
    ).toBeNull();
  });

  it("rejects a non-null reviewDate before the start date", () => {
    expect(validateGoalPatch(baseGoal(), { reviewDate: "2025-01-01" })).toEqual(
      { kind: "review_date_before_start" },
    );
  });
});

describe("applyGoalPatch", () => {
  it("advances updatedAt and preserves untouched fields", () => {
    const stored = baseGoal();
    const next = applyGoalPatch(
      stored,
      { pace: "aggressive" },
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(next.pace).toBe("aggressive");
    expect(next.status).toBe(stored.status);
    expect(next.kind).toBe(stored.kind);
    expect(next.startsOn).toBe(stored.startsOn);
    expect(next.createdAt).toEqual(stored.createdAt);
    expect(next.updatedAt).toEqual(new Date("2026-06-01T00:00:00Z"));
  });

  it("clears the review date when the patch sets it to null", () => {
    const stored = baseGoal({ reviewDate: "2026-06-01" });
    const next = applyGoalPatch(
      stored,
      { reviewDate: null },
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(next.reviewDate).toBeUndefined();
  });

  it("preserves the review date when the patch omits it", () => {
    const stored = baseGoal({ reviewDate: "2026-06-01" });
    const next = applyGoalPatch(
      stored,
      { pace: "aggressive" },
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(next.reviewDate).toBe("2026-06-01");
  });

  it("preserves id, userId, createdAt, and kind across updates", () => {
    const stored = baseGoal();
    const next = applyGoalPatch(
      stored,
      { pace: "aggressive" },
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(next.id).toBe(stored.id);
    expect(next.userId).toBe(stored.userId);
    expect(next.createdAt).toEqual(stored.createdAt);
    expect(next.kind).toBe(stored.kind);
  });
});
