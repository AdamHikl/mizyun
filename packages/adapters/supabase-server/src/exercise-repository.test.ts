import { describe, expect, it, vi } from "vitest";

import type { StoredExercise, UserId } from "@mizyun/core";

import { SupabaseExerciseRepository } from "./exercise-repository.js";
import { RepositoryError } from "./repository-error.js";
import type {
  RepositorySupabaseClient,
  RepositorySingleResult,
  RepositoryListResult,
} from "./index.js";

const exerciseRow = {
  id: "00000000-0000-4000-8000-00000000c001",
  user_id: "00000000-0000-4000-8000-000000000001",
  name: "Back squat",
  instructions: "Keep your back flat.",
  metadata: { equipment: "barbell" },
  created_at: "2026-07-10T08:00:00.000Z",
  updated_at: "2026-07-10T08:00:00.000Z",
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

describe("SupabaseExerciseRepository.create", () => {
  it("returns the parsed stored exercise", async () => {
    const repo = new SupabaseExerciseRepository({
      clientFor: () =>
        fakeClient({ insertSingle: { data: exerciseRow, error: null } }),
    });
    const stored: StoredExercise = {
      id: "00000000-0000-4000-8000-00000000c001",
      userId: "00000000-0000-4000-8000-000000000001" as UserId,
      name: "Back squat",
      instructions: "Keep your back flat.",
      metadata: { equipment: "barbell" },
      createdAt: new Date("2026-07-10T08:00:00.000Z"),
      updatedAt: new Date("2026-07-10T08:00:00.000Z"),
    };
    const result = await repo.create(
      "00000000-0000-4000-8000-000000000001" as UserId,
      stored,
      { accessToken: "token" },
    );
    expect(result.name).toBe("Back squat");
    expect(result.metadata).toEqual({ equipment: "barbell" });
  });
});

describe("SupabaseExerciseRepository.list", () => {
  it("returns the parsed list", async () => {
    const repo = new SupabaseExerciseRepository({
      clientFor: () =>
        fakeClient({ selectList: { data: [exerciseRow], error: null } }),
    });
    const list = await repo.list(
      "00000000-0000-4000-8000-000000000001" as UserId,
      { limit: 50, accessToken: "token" },
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(exerciseRow.id);
  });
});

describe("SupabaseExerciseRepository.getById", () => {
  it("returns null when the row is missing", async () => {
    const repo = new SupabaseExerciseRepository({
      clientFor: () =>
        fakeClient({ selectMaybeSingle: { data: null, error: null } }),
    });
    const result = await repo.getById("00000000-0000-4000-8000-000000000099", {
      accessToken: "token",
    });
    expect(result).toBeNull();
  });

  it("returns the parsed row when present", async () => {
    const repo = new SupabaseExerciseRepository({
      clientFor: () =>
        fakeClient({ selectMaybeSingle: { data: exerciseRow, error: null } }),
    });
    const result = await repo.getById(exerciseRow.id, { accessToken: "token" });
    expect(result?.name).toBe("Back squat");
  });
});

describe("SupabaseExerciseRepository.update", () => {
  it("returns the updated row on success", async () => {
    const repo = new SupabaseExerciseRepository({
      clientFor: () =>
        fakeClient({ updateSingle: { data: exerciseRow, error: null } }),
    });
    const stored: StoredExercise = {
      id: exerciseRow.id,
      userId: "00000000-0000-4000-8000-000000000001" as UserId,
      name: "Front squat",
      instructions: null,
      metadata: {},
      createdAt: new Date("2026-07-10T08:00:00.000Z"),
      updatedAt: new Date("2026-07-10T08:00:00.000Z"),
    };
    const result = await repo.update(stored, { accessToken: "token" });
    expect(result.id).toBe(exerciseRow.id);
  });
});

describe("SupabaseExerciseRepository.delete", () => {
  it("returns true when the row was removed", async () => {
    const repo = new SupabaseExerciseRepository({
      clientFor: () =>
        fakeClient({
          selectList: {
            data: [{ id: "00000000-0000-4000-8000-00000000c001" }],
            error: null,
          },
        }),
    });
    const removed = await repo.delete(exerciseRow.id, { accessToken: "token" });
    expect(removed).toBe(true);
  });

  it("returns false when no row was removed", async () => {
    const repo = new SupabaseExerciseRepository({
      clientFor: () => fakeClient({ selectList: { data: [], error: null } }),
    });
    const removed = await repo.delete("00000000-0000-4000-8000-000000000099", {
      accessToken: "token",
    });
    expect(removed).toBe(false);
  });
});
