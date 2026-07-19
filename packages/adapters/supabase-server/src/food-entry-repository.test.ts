import { describe, expect, it, vi } from "vitest";

import type { StoredFoodEntry, UserId } from "@mizyun/core";

import { SupabaseFoodEntryRepository } from "./food-entry-repository.js";
import { RepositoryError } from "./repository-error.js";
import type {
  RepositorySupabaseClient,
  RepositorySingleResult,
  RepositoryListResult,
} from "./index.js";

const entryRow = {
  id: "00000000-0000-4000-8000-00000000e001",
  user_id: "00000000-0000-4000-8000-000000000001",
  consumed_at: "2026-07-17T08:00:00.000Z",
  name: "Toast",
  calories_kcal: 200,
  calories_low_kcal: null,
  calories_high_kcal: null,
  protein_g: 5,
  carbohydrate_g: 30,
  fat_g: 4,
  source: "manual" as const,
  confidence: null,
  confirmed_by_user: true,
  details: {},
  created_at: "2026-07-17T08:00:00.000Z",
  updated_at: "2026-07-17T08:00:00.000Z",
};

const fakeClient = (opts: {
  selectMaybeSingle?: RepositorySingleResult<unknown>;
  insertSingle?: RepositorySingleResult<unknown>;
  updateSingle?: RepositorySingleResult<unknown>;
  selectList?: RepositoryListResult<unknown>;
}): RepositorySupabaseClient => {
  return {
    from: (_t?: string) => {
      const builder = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
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
    auth: {
      setSession: vi.fn().mockResolvedValue({
        data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
        error: null,
      }),
    },
  };
};

describe("SupabaseFoodEntryRepository.create", () => {
  it("returns the parsed stored entry", async () => {
    const repo = new SupabaseFoodEntryRepository({
      clientFor: () =>
        fakeClient({ insertSingle: { data: entryRow, error: null } }),
    });
    const entry: StoredFoodEntry = {
      id: "00000000-0000-4000-8000-00000000e001",
      userId: "00000000-0000-4000-8000-000000000001" as UserId,
      source: "manual",
      confidence: null,
      confirmedByUser: true,
      name: "Toast",
      consumedAt: new Date("2026-07-17T08:00:00.000Z"),
      caloriesKcal: 200,
      proteinG: 5,
      carbohydrateG: 30,
      fatG: 4,
      details: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const stored = await repo.create(
      "00000000-0000-4000-8000-000000000001" as UserId,
      entry,
      { accessToken: "token" },
    );
    expect(stored.caloriesKcal).toBe(200);
    expect(stored.proteinG).toBe(5);
  });

  it("throws when the insert returns an error", async () => {
    const repo = new SupabaseFoodEntryRepository({
      clientFor: () =>
        fakeClient({
          insertSingle: { data: null, error: { message: "RLS" } },
        }),
    });
    await expect(
      repo.create(
        "00000000-0000-4000-8000-000000000001" as UserId,
        {
          id: "00000000-0000-4000-8000-00000000e001",
          userId: "00000000-0000-4000-8000-000000000001" as UserId,
          source: "manual",
          confidence: null,
          confirmedByUser: true,
          name: "Toast",
          consumedAt: new Date(),
          caloriesKcal: 200,
          proteinG: 5,
          carbohydrateG: 30,
          fatG: 4,
          details: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { accessToken: "token" },
      ),
    ).rejects.toBeInstanceOf(RepositoryError);
  });
});

describe("SupabaseFoodEntryRepository.list", () => {
  it("returns the parsed list with from/to filters applied via the chain", async () => {
    const repo = new SupabaseFoodEntryRepository({
      clientFor: () =>
        fakeClient({ selectList: { data: [entryRow], error: null } }),
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
    expect(list[0]?.caloriesKcal).toBe(200);
  });

  it("returns an empty array when the underlying query has no rows", async () => {
    const repo = new SupabaseFoodEntryRepository({
      clientFor: () => fakeClient({ selectList: { data: [], error: null } }),
    });
    const list = await repo.list(
      "00000000-0000-4000-8000-000000000001" as UserId,
      {
        from: null,
        to: null,
        limit: 50,
        accessToken: "token",
      },
    );
    expect(list).toEqual([]);
  });

  it("throws when the underlying query returns an error", async () => {
    const repo = new SupabaseFoodEntryRepository({
      clientFor: () =>
        fakeClient({
          selectList: { data: [], error: { message: "boom" } },
        }),
    });
    await expect(
      repo.list("00000000-0000-4000-8000-000000000001" as UserId, {
        from: null,
        to: null,
        limit: 50,
        accessToken: "token",
      }),
    ).rejects.toBeInstanceOf(RepositoryError);
  });
});

describe("SupabaseFoodEntryRepository.delete", () => {
  it("returns true when a row was removed", async () => {
    const repo = new SupabaseFoodEntryRepository({
      clientFor: () =>
        fakeClient({
          selectList: {
            data: [{ id: "00000000-0000-4000-8000-00000000e001" }],
            error: null,
          },
        }),
    });
    const removed = await repo.delete("00000000-0000-4000-8000-00000000e001", {
      accessToken: "token",
    });
    expect(removed).toBe(true);
  });

  it("returns false when no row was removed", async () => {
    const repo = new SupabaseFoodEntryRepository({
      clientFor: () => fakeClient({ selectList: { data: [], error: null } }),
    });
    const removed = await repo.delete("00000000-0000-4000-8000-00000000e099", {
      accessToken: "token",
    });
    expect(removed).toBe(false);
  });
});
