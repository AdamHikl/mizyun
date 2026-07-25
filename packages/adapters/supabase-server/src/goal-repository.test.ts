import { describe, expect, it, vi } from "vitest";

import type { StoredGoal, UserId } from "@mizyun/core";

import { SupabaseGoalRepository } from "./goal-repository.js";
import { RepositoryError } from "./repository-error.js";
import type {
  RepositorySupabaseClient,
  RepositorySingleResult,
  RepositoryListResult,
} from "./index.js";

const goalRow = {
  id: "00000000-0000-4000-8000-00000000b001",
  user_id: "00000000-0000-4000-8000-000000000001",
  kind: "cut" as const,
  status: "active" as const,
  pace: "steady" as const,
  target: { weightKg: 78 },
  starts_on: "2026-01-01",
  target_date: "2026-04-01",
  review_date: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
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
  };
};

describe("SupabaseGoalRepository.getActive", () => {
  it("returns the parsed stored goal", async () => {
    const repo = new SupabaseGoalRepository({
      clientFor: () =>
        fakeClient({ selectMaybeSingle: { data: goalRow, error: null } }),
    });
    const active = await repo.getActive(
      "00000000-0000-4000-8000-000000000001" as UserId,
      { accessToken: "token" },
    );
    expect(active?.kind).toBe("cut");
    expect(active?.pace).toBe("steady");
    expect(active?.target.weightKg).toBe(78);
  });

  it("returns null when no active goal exists", async () => {
    const repo = new SupabaseGoalRepository({
      clientFor: () =>
        fakeClient({ selectMaybeSingle: { data: null, error: null } }),
    });
    const active = await repo.getActive(
      "00000000-0000-4000-8000-000000000001" as UserId,
      { accessToken: "token" },
    );
    expect(active).toBeNull();
  });

  it("throws when the underlying query fails", async () => {
    const repo = new SupabaseGoalRepository({
      clientFor: () =>
        fakeClient({
          selectMaybeSingle: { data: null, error: { message: "RLS" } },
        }),
    });
    await expect(
      repo.getActive("00000000-0000-4000-8000-000000000001" as UserId, {
        accessToken: "token",
      }),
    ).rejects.toBeInstanceOf(RepositoryError);
  });
});

describe("SupabaseGoalRepository.create", () => {
  it("translates the partial-unique violation into a typed error", async () => {
    const repo = new SupabaseGoalRepository({
      clientFor: () =>
        fakeClient({
          insertSingle: {
            data: null,
            error: {
              message:
                'duplicate key value violates unique constraint "goals_one_active_per_user"',
            },
          },
        }),
    });
    const stored: StoredGoal = {
      id: "00000000-0000-4000-8000-00000000b001",
      userId: "00000000-0000-4000-8000-000000000001" as UserId,
      kind: "cut",
      status: "active",
      pace: "steady",
      target: { weightKg: 78 },
      startsOn: "2026-01-01",
      targetDate: "2026-04-01",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await expect(
      repo.create("00000000-0000-4000-8000-000000000001" as UserId, stored, {
        accessToken: "token",
      }),
    ).rejects.toThrow("user already has an active goal");
  });

  it("re-throws non-partial-unique errors verbatim", async () => {
    const repo = new SupabaseGoalRepository({
      clientFor: () =>
        fakeClient({
          insertSingle: {
            data: null,
            error: { message: "permission denied" },
          },
        }),
    });
    const stored: StoredGoal = {
      id: "00000000-0000-4000-8000-00000000b001",
      userId: "00000000-0000-4000-8000-000000000001" as UserId,
      kind: "cut",
      status: "active",
      pace: "steady",
      target: { weightKg: 78 },
      startsOn: "2026-01-01",
      targetDate: "2026-04-01",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await expect(
      repo.create("00000000-0000-4000-8000-000000000001" as UserId, stored, {
        accessToken: "token",
      }),
    ).rejects.toThrow();
  });
});

describe("SupabaseGoalRepository.fromRow", () => {
  it("throws when pace is null (pre-migration row)", async () => {
    const repo = new SupabaseGoalRepository({
      clientFor: () =>
        fakeClient({
          selectMaybeSingle: {
            data: { ...goalRow, pace: null },
            error: null,
          },
        }),
    });
    await expect(
      repo.getActive("00000000-0000-4000-8000-000000000001" as UserId, {
        accessToken: "token",
      }),
    ).rejects.toThrow(/null pace/);
  });

  it("includes reviewDate in the wire shape when present", async () => {
    const repo = new SupabaseGoalRepository({
      clientFor: () =>
        fakeClient({
          selectMaybeSingle: {
            data: { ...goalRow, review_date: "2026-03-01" },
            error: null,
          },
        }),
    });
    const active = await repo.getActive(
      "00000000-0000-4000-8000-000000000001" as UserId,
      { accessToken: "token" },
    );
    expect(active?.reviewDate).toBe("2026-03-01");
  });
});
