import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  AccountExport,
  BodyMeasurementRepository,
  ConversationRepository,
  ExerciseRepository,
  FeedbackRepository,
  FoodEntryRepository,
  GoalRepository,
  MediaAssetRepository,
  ProfileRepository,
  UserId,
  WorkoutRepository,
  WorkoutSetRepository,
} from "@mizyun/core";
import type { MemoryStore } from "@mizyun/memory";

import { SupabaseAccountRepository } from "./account-repository.js";
import type { RepositorySupabaseClient } from "./index.js";
import {
  MediaStorageError,
  type SupabaseMediaStorage,
} from "./media-storage.js";
import { RepositoryError } from "./repository-error.js";

const testUserId = "00000000-0000-4000-8000-000000000001" as UserId;

interface JobRow {
  id: string;
  user_id: string;
  challenge_hash: string;
  status: string;
  stage: string;
  expires_at: string;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const createMockJobsTable = (initialRows: JobRow[] = []) => {
  const rows = [...initialRows];

  const createQueryBuilder = () => {
    let filtered = [...rows];

    const builder: any = {
      eq: vi.fn((col: string, val: unknown) => {
        filtered = filtered.filter((r) => (r as any)[col] === val);
        return builder;
      }),
      order: vi.fn((col: string, options?: { ascending?: boolean }) => {
        const asc = options?.ascending ?? true;
        filtered.sort((a, b) => {
          const valA = (a as any)[col];
          const valB = (b as any)[col];
          if (valA < valB) return asc ? -1 : 1;
          if (valA > valB) return asc ? 1 : -1;
          return 0;
        });
        return builder;
      }),
      limit: vi.fn((count: number) => {
        filtered = filtered.slice(0, count);
        return builder;
      }),
      maybeSingle: vi.fn(async () => ({
        data: filtered[0] ?? null,
        error: null,
      })),
      single: vi.fn(async () => ({
        data: filtered[0] ?? null,
        error: filtered[0] ? null : { message: "No rows found" },
      })),
      then: (resolve: (v: any) => void) => {
        resolve({ data: filtered, error: null });
      },
    };
    return builder;
  };

  const from = vi.fn((table: string) => {
    if (table !== "account_deletion_jobs") {
      throw new Error(`Unexpected table ${table}`);
    }

    return {
      select: vi.fn(() => createQueryBuilder()),
      insert: vi.fn((rowOrRows: any) => {
        const toInsert = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
        for (const item of toInsert) {
          const newRow: JobRow = {
            id: item.id ?? crypto.randomUUID(),
            user_id: item.user_id,
            challenge_hash: item.challenge_hash,
            status: item.status ?? "challenge_issued",
            stage: item.stage ?? "none",
            expires_at: item.expires_at,
            completed_at: item.completed_at ?? null,
            error_message: item.error_message ?? null,
            created_at: item.created_at ?? new Date().toISOString(),
            updated_at: item.updated_at ?? new Date().toISOString(),
          };
          rows.push(newRow);
        }
        return {
          ...createQueryBuilder(),
          error: null,
        };
      }),
      update: vi.fn((patch: Partial<JobRow>) => {
        return {
          eq: vi.fn((col: string, val: unknown) => {
            for (const r of rows) {
              if ((r as any)[col] === val) {
                Object.assign(r, patch);
              }
            }
            return { error: null };
          }),
        };
      }),
    };
  });

  return { rows, from };
};

describe("SupabaseAccountRepository", () => {
  const createMockOptions = (overrides = {}) => {
    const profileRepository = {
      getOrCreate: vi
        .fn()
        .mockResolvedValue({ userId: testUserId, displayName: "Test User" }),
    } as unknown as ProfileRepository;

    const goalRepository = {
      getHistory: vi.fn().mockResolvedValue([]),
    } as unknown as GoalRepository;

    const foodEntryRepository = {
      list: vi.fn().mockResolvedValue([]),
    } as unknown as FoodEntryRepository;

    const exerciseRepository = {
      list: vi.fn().mockResolvedValue([]),
    } as unknown as ExerciseRepository;

    const workoutRepository = {
      list: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    } as unknown as WorkoutRepository;

    const workoutSetRepository = {
      listForWorkout: vi.fn().mockResolvedValue([]),
      deleteAllForWorkout: vi.fn().mockResolvedValue(0),
    } as unknown as WorkoutSetRepository;

    const bodyMeasurementRepository = {
      list: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    } as unknown as BodyMeasurementRepository;

    const conversationRepository = {
      list: vi.fn().mockResolvedValue([
        {
          id: "conv-1",
          title: "Test Thread",
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
      listMessages: vi.fn().mockResolvedValue([
        {
          id: "msg-1",
          role: "user",
          text: "Hello",
          status: "complete",
          createdAt: new Date(),
        },
      ]),
      deleteAllForUser: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConversationRepository;

    const feedbackRepository = {
      listForUser: vi.fn().mockResolvedValue([]),
      deleteAllForUser: vi.fn().mockResolvedValue(0),
    } as unknown as FeedbackRepository;

    const mediaAssetRepository = {
      list: vi.fn().mockResolvedValue([
        {
          id: "media-1",
          bucketId: "private-media",
          objectPath: `${testUserId}/photo.jpg`,
          createdAt: new Date(),
        },
      ]),
    } as unknown as MediaAssetRepository;

    const mediaStorage = {
      remove: vi.fn().mockResolvedValue(undefined),
    } as unknown as SupabaseMediaStorage;

    const memoryStore = {
      list: vi.fn().mockResolvedValue([{ id: "mem-1" }]),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as MemoryStore;

    const deleteUserMock = vi.fn().mockResolvedValue({ data: {}, error: null });
    const jobsTable = createMockJobsTable();
    const serviceRoleClient = {
      from: jobsTable.from,
      auth: {
        admin: {
          deleteUser: deleteUserMock,
        },
      },
    } as unknown as RepositorySupabaseClient;

    return {
      profileRepository,
      goalRepository,
      foodEntryRepository,
      exerciseRepository,
      workoutRepository,
      workoutSetRepository,
      bodyMeasurementRepository,
      conversationRepository,
      feedbackRepository,
      mediaAssetRepository,
      mediaStorage,
      memoryStore,
      jobsTable,
      serviceRoleClient,
      deleteUserMock,
      ...overrides,
    };
  };

  it("exportForUser fails closed if accessToken is empty", async () => {
    const opts = createMockOptions();
    const repo = new SupabaseAccountRepository(opts);

    await expect(
      repo.exportForUser(testUserId, { accessToken: "" }),
    ).rejects.toThrow("requires a verified access token");
  });

  it("exportForUser gathers all categories using verified accessToken", async () => {
    const opts = createMockOptions();
    const repo = new SupabaseAccountRepository(opts);

    const result = await repo.exportForUser(testUserId, {
      accessToken: "valid-jwt",
    });

    expect(opts.profileRepository.getOrCreate).toHaveBeenCalledWith(
      testUserId,
      expect.objectContaining({ accessToken: "valid-jwt" }),
    );
    expect(opts.goalRepository.getHistory).toHaveBeenCalledWith(testUserId, {
      accessToken: "valid-jwt",
    });
    expect(opts.foodEntryRepository.list).toHaveBeenCalledWith(
      testUserId,
      expect.objectContaining({ accessToken: "valid-jwt" }),
    );
    expect(opts.mediaAssetRepository.list).toHaveBeenCalledWith(
      testUserId,
      expect.objectContaining({ accessToken: "valid-jwt" }),
    );
    expect(opts.conversationRepository!.list).toHaveBeenCalledWith(
      testUserId,
      expect.objectContaining({ accessToken: "valid-jwt" }),
    );

    expect(result.userId).toBe(testUserId);
    expect(result.privateMedia).toHaveLength(1);
    expect(result.privateMedia[0]?.id).toBe("media-1");
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]?.messages).toHaveLength(1);
  });

  it("issueDeletionChallenge produces unique token and stores job in public.account_deletion_jobs", async () => {
    const opts = createMockOptions();
    const repo = new SupabaseAccountRepository(opts);
    const now = new Date("2026-09-08T10:00:00Z");

    const token = await repo.issueDeletionChallenge(testUserId, {
      ttlSeconds: 300,
      now,
    });
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(10);

    const job = await repo.getDeletionJob(testUserId);
    expect(job).not.toBeNull();
    expect(job?.userId).toBe(testUserId);
    expect(job?.status).toBe("challenge_issued");
    expect(job?.stage).toBe("none");
    expect(job?.expiresAt.getTime()).toBe(now.getTime() + 300_000);

    const expectedHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");
    expect(job?.challengeHash).toBe(expectedHash);
  });

  it("deleteUser rejects missing challenge", async () => {
    const opts = createMockOptions();
    const repo = new SupabaseAccountRepository(opts);

    const res = await repo.deleteUser(testUserId, {
      confirmationToken: "random-token",
      now: new Date(),
      accessToken: "token",
    });

    expect(res).toEqual({
      deleted: false,
      reason: { kind: "confirmation_token_missing" },
    });
  });

  it("deleteUser rejects expired challenge", async () => {
    const opts = createMockOptions();
    const repo = new SupabaseAccountRepository(opts);
    const start = new Date("2026-09-08T10:00:00Z");
    const token = await repo.issueDeletionChallenge(testUserId, {
      ttlSeconds: 60,
      now: start,
    });

    const later = new Date("2026-09-08T10:02:00Z");
    const res = await repo.deleteUser(testUserId, {
      confirmationToken: token,
      now: later,
      accessToken: "token",
    });

    expect(res).toEqual({
      deleted: false,
      reason: { kind: "confirmation_token_expired" },
    });
  });

  it("deleteUser rejects token mismatch", async () => {
    const opts = createMockOptions();
    const repo = new SupabaseAccountRepository(opts);
    const start = new Date("2026-09-08T10:00:00Z");
    await repo.issueDeletionChallenge(testUserId, {
      ttlSeconds: 300,
      now: start,
    });

    const res = await repo.deleteUser(testUserId, {
      confirmationToken: "wrong-token",
      now: start,
      accessToken: "token",
    });

    expect(res).toEqual({
      deleted: false,
      reason: { kind: "confirmation_token_mismatch" },
    });
  });

  it("deleteUser executes full multi-stage cascade: media storage, memories, and auth admin deletion", async () => {
    const opts = createMockOptions();
    const repo = new SupabaseAccountRepository(opts);
    const now = new Date("2026-09-08T10:00:00Z");
    const token = await repo.issueDeletionChallenge(testUserId, {
      ttlSeconds: 300,
      now,
    });

    const res = await repo.deleteUser(testUserId, {
      confirmationToken: token,
      now,
      accessToken: "valid-jwt",
    });

    expect(res).toEqual({ deleted: true });

    // 1. Media storage removal
    expect(opts.mediaStorage!.remove).toHaveBeenCalledWith(
      "private-media",
      `${testUserId}/photo.jpg`,
      { accessToken: "valid-jwt" },
    );

    // 2. Memory deletion
    expect(opts.memoryStore!.delete).toHaveBeenCalledWith(testUserId, "mem-1", {
      accessToken: "valid-jwt",
    });

    // 3. Auth admin deleteUser
    expect(opts.deleteUserMock).toHaveBeenCalledWith(testUserId);

    // 4. Tombstone job persisted with completed status
    const job = await repo.getDeletionJob(testUserId);
    expect(job?.status).toBe("completed");
    expect(job?.stage).toBe("done");
    expect(job?.completedAt).not.toBeNull();

    // 5. Idempotent recovery for lost final response: retry returns deleted: true
    const retry = await repo.deleteUser(testUserId, {
      confirmationToken: token,
      now,
      accessToken: "valid-jwt",
    });
    expect(retry).toEqual({ deleted: true });
    // And does not re-invoke auth admin delete
    expect(opts.deleteUserMock).toHaveBeenCalledTimes(1);
  });

  it("fault test: storage failure halts deletion and preserves auth user", async () => {
    const opts = createMockOptions();
    (opts.mediaStorage!.remove as any).mockRejectedValueOnce(
      new MediaStorageError("Storage network outage"),
    );
    const repo = new SupabaseAccountRepository(opts);
    const now = new Date("2026-09-08T10:00:00Z");
    const token = await repo.issueDeletionChallenge(testUserId, {
      ttlSeconds: 300,
      now,
    });

    await expect(
      repo.deleteUser(testUserId, {
        confirmationToken: token,
        now,
        accessToken: "valid-jwt",
      }),
    ).rejects.toThrow(
      "Account deletion failed during storage cleanup: Storage network outage",
    );

    // Auth admin deleteUser MUST NOT have been called
    expect(opts.deleteUserMock).not.toHaveBeenCalled();

    // Job state should record failure at storage stage
    const job = await repo.getDeletionJob(testUserId);
    expect(job?.status).toBe("failed");
    expect(job?.stage).toBe("storage");
    expect(job?.errorMessage).toContain("Storage network outage");
  });

  it("fault test: memory failure halts deletion and preserves auth user", async () => {
    const opts = createMockOptions();
    (opts.memoryStore!.delete as any).mockRejectedValueOnce(
      new Error("Vector memory store connection refused"),
    );
    const repo = new SupabaseAccountRepository(opts);
    const now = new Date("2026-09-08T10:00:00Z");
    const token = await repo.issueDeletionChallenge(testUserId, {
      ttlSeconds: 300,
      now,
    });

    await expect(
      repo.deleteUser(testUserId, {
        confirmationToken: token,
        now,
        accessToken: "valid-jwt",
      }),
    ).rejects.toThrow(
      "Account deletion failed during memory cleanup: Vector memory store connection refused",
    );

    // Auth admin deleteUser MUST NOT have been called
    expect(opts.deleteUserMock).not.toHaveBeenCalled();

    // Job state should record failure at memory stage
    const job = await repo.getDeletionJob(testUserId);
    expect(job?.status).toBe("failed");
    expect(job?.stage).toBe("memory");
    expect(job?.errorMessage).toContain(
      "Vector memory store connection refused",
    );
  });

  it("fault test: auth admin failure updates job to failed", async () => {
    const opts = createMockOptions();
    opts.deleteUserMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Internal Auth Service Error" },
    });
    const repo = new SupabaseAccountRepository(opts);
    const now = new Date("2026-09-08T10:00:00Z");
    const token = await repo.issueDeletionChallenge(testUserId, {
      ttlSeconds: 300,
      now,
    });

    await expect(
      repo.deleteUser(testUserId, {
        confirmationToken: token,
        now,
        accessToken: "valid-jwt",
      }),
    ).rejects.toThrow(
      "Account deletion failed during auth deletion: Internal Auth Service Error",
    );

    const job = await repo.getDeletionJob(testUserId);
    expect(job?.status).toBe("failed");
    expect(job?.stage).toBe("auth");
    expect(job?.errorMessage).toContain("Internal Auth Service Error");
  });

  it("fault test: fails closed if serviceRoleClient lacks auth admin capability", async () => {
    const opts = createMockOptions({
      serviceRoleClient: {
        from: createMockJobsTable().from,
        auth: {},
      } as unknown as RepositorySupabaseClient,
    });
    const repo = new SupabaseAccountRepository(opts);
    const now = new Date("2026-09-08T10:00:00Z");
    const token = await repo.issueDeletionChallenge(testUserId, {
      ttlSeconds: 300,
      now,
    });

    await expect(
      repo.deleteUser(testUserId, {
        confirmationToken: token,
        now,
        accessToken: "valid-jwt",
      }),
    ).rejects.toThrow(
      "SupabaseAccountRepository requires auth.admin.deleteUser capability",
    );
  });
});
