import { describe, expect, it } from "vitest";

import { goalCreateSchema, goalPatchSchema, goalSchema } from "./index.js";

const storedGoal = {
  id: "10000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "cut",
  status: "active",
  pace: "steady",
  target: { weightKg: 78 },
  startsOn: "2026-01-01",
  targetDate: "2026-04-01",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const createBody = {
  kind: "cut",
  pace: "steady",
  target: { weightKg: 78 },
  startsOn: "2026-01-01",
};

describe("goalSchema optional target date", () => {
  it("parses a stored goal with a null target date", () => {
    const parsed = goalSchema.parse({ ...storedGoal, targetDate: null });
    expect(parsed.targetDate).toBeNull();
  });

  it("still requires the field to be present (null, not omitted)", () => {
    const { targetDate: _omitted, ...withoutDate } = storedGoal;
    expect(goalSchema.safeParse(withoutDate).success).toBe(false);
  });

  it("still rejects a non-null target date before startsOn", () => {
    const result = goalSchema.safeParse({
      ...storedGoal,
      targetDate: "2025-12-31",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["targetDate"]);
  });
});

describe("goalCreateSchema optional target date", () => {
  it("accepts a create body without a target date", () => {
    const parsed = goalCreateSchema.parse(createBody);
    expect(parsed.targetDate).toBeUndefined();
  });

  it("accepts an explicit null target date", () => {
    expect(
      goalCreateSchema.parse({ ...createBody, targetDate: null }).targetDate,
    ).toBeNull();
  });

  it("keeps accepting a dated create body from older clients", () => {
    expect(
      goalCreateSchema.parse({ ...createBody, targetDate: "2026-04-01" })
        .targetDate,
    ).toBe("2026-04-01");
  });

  it("still rejects a target date before startsOn", () => {
    const result = goalCreateSchema.safeParse({
      ...createBody,
      targetDate: "2025-12-31",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["targetDate"]);
  });
});

describe("goalPatchSchema optional target date", () => {
  it("accepts {targetDate: null} as a non-empty clearing patch", () => {
    const parsed = goalPatchSchema.parse({ targetDate: null });
    expect(parsed).toEqual({ targetDate: null });
  });

  it("still rejects an empty patch", () => {
    expect(goalPatchSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a malformed target date", () => {
    expect(goalPatchSchema.safeParse({ targetDate: "soon" }).success).toBe(
      false,
    );
  });
});
