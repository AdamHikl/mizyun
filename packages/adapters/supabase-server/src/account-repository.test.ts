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
import type { SupabaseMediaStorage } from "./media-storage.js";

const testUserId = "00000000-0000-4000-8000-000000000001" as UserId;

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
    const serviceRoleClient = {
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

  it("issueDeletionChallenge produces unique token with TTL", async () => {
    const opts = createMockOptions();
    const repo = new SupabaseAccountRepository(opts);
    const now = new Date("2026-09-08T10:00:00Z");

    const token = await repo.issueDeletionChallenge(testUserId, {
      ttlSeconds: 300,
      now,
    });
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(10);

    const challenge = repo.__peekChallenge(testUserId);
    expect(challenge?.token).toBe(token);
    expect(challenge?.expiresAtMs).toBe(now.getTime() + 300_000);
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

  it("deleteUser executes full cascade: media storage, memories, and auth admin deletion", async () => {
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

    // 4. Token consumed: second attempt returns confirmation_token_missing
    const retry = await repo.deleteUser(testUserId, {
      confirmationToken: token,
      now,
      accessToken: "valid-jwt",
    });
    expect(retry).toEqual({
      deleted: false,
      reason: { kind: "confirmation_token_missing" },
    });
  });
});
