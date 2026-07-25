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
