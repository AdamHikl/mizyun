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
  worker_id?: string | null;
  lease_expires_at?: string | null;
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
      range: vi.fn((fromIdx: number, toIdx: number) => {
        filtered = filtered.slice(fromIdx, toIdx + 1);
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
    if (table === "media_assets") {
      return {
        select: vi.fn(() => createQueryBuilder()),
      };
    }
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
            worker_id: item.worker_id ?? null,
            lease_expires_at: item.lease_expires_at ?? null,
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
        const filters: Array<{ col: string; val: unknown }> = [];
        const execute = () => {
          let matched = [...rows];
          for (const f of filters) {
            matched = matched.filter((r) => (r as any)[f.col] === f.val);
          }
          for (const r of matched) {
            Object.assign(r, patch);
          }
          return matched;
        };

        const updateBuilder: any = {
          eq: vi.fn((col: string, val: unknown) => {
            filters.push({ col, val });
            return updateBuilder;
          }),
          select: vi.fn(() => {
            const matched = execute();
            return {
              data: matched,
              error: null,
            };
          }),
          error: null,
          then: (resolve: (v: any) => void) => {
            const matched = execute();
            resolve({ data: matched, error: null });
          },
        };
        return updateBuilder;
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

  it("Community cleanup completes before external Auth erasure", async () => {
    const opts = createMockOptions();
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ deleted_count: 500, complete: false }],
        error: null,
      })
      .mockResolvedValue({
        data: [{ deleted_count: 2, complete: true }],
        error: null,
      });
    Object.assign(opts.serviceRoleClient, { rpc });
    const repo = new SupabaseAccountRepository({
      ...opts,
      communityLifecycleEnabled: true,
    });
    const now = new Date();
    const confirmationToken = await repo.issueDeletionChallenge(testUserId, {
      ttlSeconds: 300,
      now,
    });
    await expect(
      repo.deleteUser(testUserId, {
        confirmationToken,
        now,
        accessToken: "token",
      }),
    ).resolves.toEqual({ deleted: true });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith(
      "community_account_cleanup_batch",
      expect.objectContaining({
        p_user_id: testUserId,
        p_limit: 500,
        p_worker_id: expect.any(String),
      }),
    );
    expect(rpc.mock.invocationCallOrder[1]).toBeLessThan(
      opts.deleteUserMock.mock.invocationCallOrder[0]!,
    );
  });

  it("Community cleanup failure preserves Auth and resumes after lease loss", async () => {
    const opts = createMockOptions();
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: "lost response" },
      })
      .mockResolvedValue({
        data: [{ deleted_count: 0, complete: true }],
        error: null,
      });
    Object.assign(opts.serviceRoleClient, { rpc });
    const repo = new SupabaseAccountRepository({
      ...opts,
      communityLifecycleEnabled: true,
    });
    const now = new Date();
    const confirmationToken = await repo.issueDeletionChallenge(testUserId, {
      ttlSeconds: 600,
      now,
    });
    await expect(
      repo.deleteUser(testUserId, {
        confirmationToken,
        now,
        accessToken: "token",
      }),
    ).rejects.toThrow("Community account cleanup failed");
    expect(opts.deleteUserMock).not.toHaveBeenCalled();
    expect(opts.jobsTable.rows[0]?.stage).toBe("auth");
    await expect(
      repo.deleteUser(testUserId, {
        confirmationToken,
        now: new Date(now.getTime() + 180000),
        accessToken: "token",
      }),
    ).resolves.toEqual({ deleted: true });
    expect(opts.deleteUserMock).toHaveBeenCalledTimes(1);
  });

  it("Community cleanup batch budget cannot prematurely delete Auth", async () => {
    const opts = createMockOptions();
    const rpc = vi.fn().mockResolvedValue({
      data: [{ deleted_count: 500, complete: false }],
      error: null,
    });
    Object.assign(opts.serviceRoleClient, { rpc });
    const repo = new SupabaseAccountRepository({
      ...opts,
      communityLifecycleEnabled: true,
    });
    const now = new Date();
    const confirmationToken = await repo.issueDeletionChallenge(testUserId, {
      ttlSeconds: 600,
      now,
    });
    await expect(
      repo.deleteUser(testUserId, {
        confirmationToken,
        now,
        accessToken: "token",
      }),
    ).rejects.toThrow("bounded retry");
    expect(rpc).toHaveBeenCalledTimes(20);
    expect(opts.deleteUserMock).not.toHaveBeenCalled();
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

  it("exportForUser returns complete manifest and signed URLs", async () => {
    const mediaStorage = {
      remove: vi.fn(),
      signDownloadUrl: vi.fn().mockResolvedValue({
        url: "https://signed.supabase.co/photo.jpg",
        expiresAt: new Date("2026-09-09T10:00:00Z"),
      }),
    };
    const mediaAssetRepository = {
      list: vi.fn().mockResolvedValue([
        {
          id: "asset-1",
          bucketId: "private-media",
          objectPath: `${testUserId}/photo.jpg`,
          purpose: "progress_photo",
          mimeType: "image/jpeg",
          byteSize: 1024,
          createdAt: new Date("2026-09-08T10:00:00Z"),
          deletedAt: null,
        },
      ]),
    } as unknown as MediaAssetRepository;

    const opts = createMockOptions({
      mediaStorage,
      mediaAssetRepository,
    });
    const repo = new SupabaseAccountRepository(opts);
    const result = await repo.exportForUser(testUserId, {
      accessToken: "valid-jwt",
    });

    expect(result.userId).toBe(testUserId);
    expect(result.manifest).toMatchObject({
      schemaVersion: "2026-09-08",
      completeness: "complete",
      counts: {
        profiles: 1,
        goals: 0,
        conversations: 1,
        messages: 1,
        privateMedia: 1,
      },
    });
    expect(result.privateMedia).toHaveLength(1);
    expect(result.privateMedia[0]!.downloadUrl).toBe(
      "https://signed.supabase.co/photo.jpg",
    );
  });

  it("exportForUser marks manifest partial if private media URL signing fails", async () => {
    const mediaStorage = {
      remove: vi.fn(),
      signDownloadUrl: vi.fn().mockRejectedValue(new Error("Storage timeout")),
    };
    const mediaAssetRepository = {
      list: vi.fn().mockResolvedValue([
        {
          id: "asset-1",
          bucketId: "private-media",
          objectPath: `${testUserId}/photo.jpg`,
          purpose: "progress_photo",
          mimeType: "image/jpeg",
          byteSize: 1024,
          createdAt: new Date("2026-09-08T10:00:00Z"),
          deletedAt: null,
        },
      ]),
    } as unknown as MediaAssetRepository;

    const opts = createMockOptions({ mediaStorage, mediaAssetRepository });
    const repo = new SupabaseAccountRepository(opts);
    const result = await repo.exportForUser(testUserId, {
      accessToken: "valid-jwt",
    });

    expect(result.manifest?.completeness).toBe("partial");
    expect(result.privateMedia[0]!.downloadUrl).toBeNull();
  });

  it("exportForUser with clientFor queries user_feedback (not feedback) and memory_items", async () => {
    const queriedTables: string[] = [];
    const mockClient = {
      from: vi.fn((table: string) => {
        queriedTables.push(table);
        if (table === "feedback") {
          throw new Error("relation public.feedback does not exist");
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                order: vi.fn(() => ({
                  range: vi.fn(() =>
                    Promise.resolve({ data: [], error: null }),
                  ),
                })),
                range: vi.fn(() => Promise.resolve({ data: [], error: null })),
              })),
              maybeSingle: vi.fn(() =>
                Promise.resolve({ data: null, error: null }),
              ),
            })),
          })),
        };
      }),
    } as unknown as RepositorySupabaseClient;

    const opts = createMockOptions({
      clientFor: () => mockClient,
    });
    const repo = new SupabaseAccountRepository(opts);
    const result = await repo.exportForUser(testUserId, {
      accessToken: "valid-jwt",
    });

    expect(queriedTables).toContain("user_feedback");
    expect(queriedTables).not.toContain("feedback");
    expect(queriedTables).toContain("memory_items");
    expect(queriedTables).toContain("goals");
    expect(result.manifest?.completeness).toBe("complete");
  });

  it("exports all recurring snapshots and ledger pages with the verified owner filter", async () => {
    const schedules = Array.from({ length: 501 }, (_, index) => ({
      id: `schedule-${index}`,
      user_id: testUserId,
      stopped_at: index === 0 ? "2026-10-03" : null,
      template: { name: "Synthetic meal" },
    }));
    const occurrences = Array.from({ length: 502 }, (_, index) => ({
      id: `occurrence-${index}`,
      user_id: testUserId,
      food_entry_id: null,
      skipped: true,
    }));
    const queries: {
      table: string;
      column: string;
      owner: unknown;
      from: number;
      to: number;
    }[] = [];
    const client = {
      from: vi.fn((table: string) => {
        let owner: unknown;
        let column = "";
        const query = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((col: string, value: unknown) => {
            column = col;
            owner = value;
            return query;
          }),
          order: vi.fn().mockReturnThis(),
          range: vi.fn(async (from: number, to: number) => {
            queries.push({ table, column, owner, from, to });
            const rows =
              table === "recurring_meal_schedules"
                ? schedules
                : table === "recurring_meal_occurrences"
                  ? occurrences
                  : [];
            return { data: rows.slice(from, to + 1), error: null };
          }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
        return query;
      }),
    } as unknown as RepositorySupabaseClient;
    const clientFor = vi.fn(() => client);
    const repo = new SupabaseAccountRepository(
      createMockOptions({ clientFor }),
    );
    const result = await repo.exportForUser(testUserId, {
      accessToken: "verified-owner-token",
    });
    expect(clientFor).toHaveBeenCalledWith("verified-owner-token");
    expect(result.recurringMeals?.schedules).toEqual(schedules);
    expect(result.recurringMeals?.occurrences).toEqual(occurrences);
    const recurrenceQueries = queries.filter((q) =>
      q.table.startsWith("recurring_meal_"),
    );
    expect(recurrenceQueries).toHaveLength(4);
    expect(
      recurrenceQueries.every(
        (q) => q.column === "user_id" && q.owner === testUserId,
      ),
    ).toBe(true);
    expect(recurrenceQueries.filter((q) => q.from === 500)).toHaveLength(2);
  });

  it("getDeletionJobByToken retrieves active deletion job by confirmation token", async () => {
    const opts = createMockOptions();
    const repo = new SupabaseAccountRepository(opts);
    const now = new Date("2026-09-08T10:00:00Z");
    const token = await repo.issueDeletionChallenge(testUserId, {
      ttlSeconds: 300,
      now,
    });

    const job = await repo.getDeletionJobByToken(token);
    expect(job).not.toBeNull();
    expect(job?.userId).toBe(testUserId);
    expect(job?.status).toBe("challenge_issued");

    const unknownJob = await repo.getDeletionJobByToken("non-existent-token");
    expect(unknownJob).toBeNull();
  });

  it("active in_progress lease blocks concurrent deleteUser attempt", async () => {
    const opts = createMockOptions();
    const repo = new SupabaseAccountRepository(opts);
    const now = new Date("2026-09-08T10:00:00Z");
    const token = await repo.issueDeletionChallenge(testUserId, {
      ttlSeconds: 300,
      now,
    });

    // Manually transition to in_progress with an active future lease
    const serviceClient = opts.serviceRoleClient as any;
    await serviceClient
      .from("account_deletion_jobs")
      .update({
        status: "in_progress",
        stage: "memory",
        worker_id: "worker-alpha",
        lease_expires_at: new Date("2026-09-08T10:02:00Z").toISOString(),
      })
      .eq("user_id", testUserId);

    // Concurrent request at 10:01:00Z (lease still active)
    const concurrentTime = new Date("2026-09-08T10:01:00Z");
    await expect(
      repo.deleteUser(testUserId, {
        confirmationToken: token,
        now: concurrentTime,
        accessToken: "valid-jwt",
      }),
    ).rejects.toThrow("Account deletion is already in progress");

    // Auth admin deleteUser MUST NOT have been called
    expect(opts.deleteUserMock).not.toHaveBeenCalled();
  });

  it("expired in_progress lease can be resumed by another worker without stage regression", async () => {
    const opts = createMockOptions();
    const repo = new SupabaseAccountRepository(opts);
    const now = new Date("2026-09-08T10:00:00Z");
    const token = await repo.issueDeletionChallenge(testUserId, {
      ttlSeconds: 600,
      now,
    });

    // Worker alpha was working on memory stage, but crashed, leaving lease expired at 10:02:00Z
    const serviceClient = opts.serviceRoleClient as any;
    await serviceClient
      .from("account_deletion_jobs")
      .update({
        status: "in_progress",
        stage: "memory",
        worker_id: "worker-alpha",
        lease_expires_at: new Date("2026-09-08T10:02:00Z").toISOString(),
      })
      .eq("user_id", testUserId);

    // Worker beta resumes at 10:03:00Z (lease expired)
    const resumeTime = new Date("2026-09-08T10:03:00Z");
    const res = await repo.deleteUser(testUserId, {
      confirmationToken: token,
      now: resumeTime,
      accessToken: "valid-jwt",
    });

    expect(res).toEqual({ deleted: true });

    // Storage removal should NOT have been run again because stage was already 'memory',
    // but the pre-auth sweep runs to ensure no orphaned uploads
    expect(opts.mediaStorage!.remove).toHaveBeenCalledWith(
      "private-media",
      `${testUserId}/photo.jpg`,
      { accessToken: "valid-jwt" },
    );

    // Memory deletion executed
    expect(opts.memoryStore!.delete).toHaveBeenCalledWith(testUserId, "mem-1", {
      accessToken: "valid-jwt",
    });

    // Auth delete executed
    expect(opts.deleteUserMock).toHaveBeenCalledWith(testUserId);

    // Tombstone successfully written
    const finalJob = await repo.getDeletionJob(testUserId);
    expect(finalJob?.status).toBe("completed");
    expect(finalJob?.stage).toBe("done");
  });
});
