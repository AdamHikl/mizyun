import { describe, expect, it, vi } from "vitest";

import type { StoredWorkout, UserId } from "@mizyun/core";

import { SupabaseWorkoutRepository } from "./workout-repository.js";
import type {
  RepositorySupabaseClient,
  RepositorySingleResult,
  RepositoryListResult,
} from "./index.js";

const workoutRow = {
  id: "00000000-0000-4000-8000-00000000b001",
  user_id: "00000000-0000-4000-8000-000000000001",
  name: "Leg day",
  started_at: "2026-07-15T08:00:00.000Z",
  completed_at: "2026-07-15T09:00:00.000Z",
  notes: null,
  source: "manual",
  details: {},
  created_at: "2026-07-15T08:00:00.000Z",
  updated_at: "2026-07-15T08:00:00.000Z",
};

const fakeClient = (opts: {
  selectMaybeSingle?: RepositorySingleResult<unknown>;
  insertSingle?: RepositorySingleResult<unknown>;
  updateSingle?: RepositorySingleResult<unknown>;
  selectList?: RepositoryListResult<unknown>;
}): RepositorySupabaseClient => ({
  from: (_t?: string) => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi
        .fn()
        .mockResolvedValue(opts.insertSingle ?? opts.updateSingle ?? null),
      maybeSingle: vi.fn().mockResolvedValue(opts.selectMaybeSingle ?? null),
      then: (resolve: (v: RepositoryListResult<unknown>) => void) => {
        resolve(opts.selectList ?? { data: [], error: null });
      },
    };
    return builder as unknown as never;
  },
  rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  auth: {
    setSession: vi.fn().mockResolvedValue({
      data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
      error: null,
    }),
  },
});

describe("SupabaseWorkoutRepository.list", () => {
  it("returns the parsed list filtered to the user", async () => {
    const repo = new SupabaseWorkoutRepository({
      clientFor: () =>
        fakeClient({ selectList: { data: [workoutRow], error: null } }),
    });
    const list = await repo.list(
      "00000000-0000-4000-8000-000000000001" as UserId,
      {
        from: new Date("2026-07-01T00:00:00Z"),
        to: new Date("2026-07-31T23:59:59Z"),
        limit: 50,
        accessToken: "token",
      },
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("Leg day");
  });

  it("applies kind filter when specified", async () => {
    let capturedEq: [string, unknown][] = [];
    const client: RepositorySupabaseClient = {
      from: () => {
        const builder = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((col: string, val: unknown) => {
            capturedEq.push([col, val]);
            return builder;
          }),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          then: (resolve: (v: RepositoryListResult<unknown>) => void) => {
            resolve({ data: [workoutRow], error: null });
          },
        };
        return builder as unknown as never;
      },
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      auth: {
        setSession: vi
          .fn()
          .mockResolvedValue({ data: { user: null }, error: null }),
      },
    };
    const repo = new SupabaseWorkoutRepository({ clientFor: () => client });
    await repo.list("00000000-0000-4000-8000-000000000001" as UserId, {
      from: null,
      to: null,
      limit: 50,
      kind: "routine",
      accessToken: "token",
    });
    expect(capturedEq).toContainEqual([
      "details->workoutLifecycle->>kind",
      "routine",
    ]);
  });
});

describe("SupabaseWorkoutRepository.findByClientOperationId", () => {
  it("returns stored workout when found", async () => {
    const rowWithOp = {
      ...workoutRow,
      client_operation_id: "11111111-2222-4333-8444-555555555555",
    };
    const repo = new SupabaseWorkoutRepository({
      clientFor: () =>
        fakeClient({ selectMaybeSingle: { data: rowWithOp, error: null } }),
    });
    const result = await repo.findByClientOperationId(
      "00000000-0000-4000-8000-000000000001" as UserId,
      "11111111-2222-4333-8444-555555555555",
      { accessToken: "token" },
    );
    expect(result).not.toBeNull();
    expect(result?.clientOperationId).toBe(
      "11111111-2222-4333-8444-555555555555",
    );
  });
});

describe("SupabaseWorkoutRepository.create", () => {
  it("returns the parsed stored workout", async () => {
    const repo = new SupabaseWorkoutRepository({
      clientFor: () =>
        fakeClient({ insertSingle: { data: workoutRow, error: null } }),
    });
    const stored: StoredWorkout = {
      id: workoutRow.id,
      userId: "00000000-0000-4000-8000-000000000001" as UserId,
      name: "Leg day",
      startedAt: new Date("2026-07-15T08:00:00Z"),
      completedAt: new Date("2026-07-15T09:00:00Z"),
      notes: null,
      source: "manual",
      details: {},
      createdAt: new Date("2026-07-15T08:00:00Z"),
      updatedAt: new Date("2026-07-15T08:00:00Z"),
    };
    const result = await repo.create(
      "00000000-0000-4000-8000-000000000001" as UserId,
      stored,
      { accessToken: "token" },
    );
    expect(result.completedAt).toBeInstanceOf(Date);
    expect(result.completedAt?.toISOString()).toBe("2026-07-15T09:00:00.000Z");
  });
});

describe("SupabaseWorkoutRepository.getById", () => {
  it("returns null when no row matches", async () => {
    const repo = new SupabaseWorkoutRepository({
      clientFor: () =>
        fakeClient({ selectMaybeSingle: { data: null, error: null } }),
    });
    const result = await repo.getById("00000000-0000-4000-8000-000000000099", {
      accessToken: "token",
    });
    expect(result).toBeNull();
  });
});

describe("SupabaseWorkoutRepository.delete", () => {
  it("returns true when a row was removed", async () => {
    const repo = new SupabaseWorkoutRepository({
      clientFor: () =>
        fakeClient({
          selectList: {
            data: [{ id: "00000000-0000-4000-8000-00000000b001" }],
            error: null,
          },
        }),
    });
    const removed = await repo.delete(workoutRow.id, { accessToken: "token" });
    expect(removed).toBe(true);
  });
});

describe("SupabaseWorkoutRepository non-strength exclusion", () => {
  it("filters running and bouldering in the query, before the limit", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const builder: Record<string, unknown> = {};
    for (const name of ["select", "eq", "order", "limit", "or", "is"])
      builder[name] = (...args: unknown[]) => {
        calls.push([name, args]);
        return builder;
      };
    builder.then = (resolve: (v: RepositoryListResult<unknown>) => void) =>
      resolve({ data: [], error: null });
    const repo = new SupabaseWorkoutRepository({
      clientFor: () =>
        ({ from: () => builder }) as unknown as RepositorySupabaseClient,
    } as never);
    await repo.list("00000000-0000-4000-8000-000000000001" as UserId, {
      from: null,
      to: null,
      limit: 5,
      excludeNonStrength: true,
      accessToken: "t",
    });
    expect(calls).toContainEqual([
      "or",
      [
        "details->>activityType.is.null,details->>activityType.not.in.(running,bouldering)",
      ],
    ]);
    expect(calls).toContainEqual(["is", ["details->runSummary", null]]);
    expect(calls).toContainEqual(["is", ["details->boulderSession", null]]);
  });
});
