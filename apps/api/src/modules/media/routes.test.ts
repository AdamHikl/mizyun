import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentOrchestrator,
  DisabledAgentProvider,
} from "@mizyun/agent-runtime";
import type { StoredMediaAsset, UserId } from "@mizyun/core";
import type { AccessTokenVerifier } from "@mizyun/identity";
import { InMemoryMemoryStore } from "@mizyun/memory";

import { buildApp } from "../../app.js";
import { InMemoryMediaAssetRepository } from "../../media-asset-repository.js";
import { InMemoryMediaStorage } from "../../media-storage.js";
import { InMemoryProfileRepository } from "../../profile-repository.js";
import type { MediaQuota } from "../../media-quota.js";
import { MediaUploadRateLimiter } from "./upload-rate-limit.js";

const userA: UserId = "00000000-0000-4000-8000-000000000001" as UserId;
const userB: UserId = "00000000-0000-4000-8000-000000000002" as UserId;

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const tokenVerifierFor = (
  principal: { readonly userId: UserId } | null,
): AccessTokenVerifier => ({
  verify: async (token) =>
    token === "valid"
      ? {
          userId: principal!.userId,
          role: "authenticated",
          accessToken: "test-token",
        }
      : null,
});

const build = (
  verifier: AccessTokenVerifier,
  planTier: "paid" | "free" = "free",
  extra: Partial<Parameters<typeof buildApp>[0]> = {},
) => {
  const mediaAssetRepository = new InMemoryMediaAssetRepository();
  const mediaStorage = new InMemoryMediaStorage();
  // The app composition root owns the storage. For tests we
  // re-create a fresh storage and inject it via the
  // `mediaStorage` dependency. The composition root needs to
  // support that injection, which it does because `mediaStorage`
  // is built into the option resolution.
  const app = buildApp({
    tokenVerifier: verifier,
    agent: new AgentOrchestrator({
      provider: new DisabledAgentProvider(),
      memories: new InMemoryMemoryStore(),
    }),
    mediaAssetRepository,
    mediaStorage,
    profileRepository: new InMemoryProfileRepository({
      defaultTimezone: "UTC",
      defaultUnitSystem: "metric",
      defaultPlanTier: planTier,
    }),
    ...extra,
  });
  apps.push(app);
  return { app, mediaAssetRepository, mediaStorage };
};

const seedAsset = (
  repo: InMemoryMediaAssetRepository,
  overrides: Partial<StoredMediaAsset> = {},
): StoredMediaAsset => {
  const asset: StoredMediaAsset = {
    id: "00000000-0000-4000-8000-00000000a001",
    userId: userA,
    bucketId: "private-media",
    objectPath: `${userA}/00000000-0000-4000-8000-00000000a001.jpg`,
    purpose: "progress",
    mimeType: "image/jpeg",
    byteSize: 1024,
    width: 1024,
    height: 1024,
    metadata: {},
    createdAt: new Date("2026-07-10T08:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
  repo.__seedForTest(asset);
  return asset;
};

describe("POST /v1/media/upload-url", () => {
  it("requires Pro for generic food retention and allows paid users", async () => {
    for (const tier of ["free", "paid"] as const) {
      const { app, mediaStorage } = build(
        tokenVerifierFor({ userId: userA }),
        tier,
      );
      const upload = vi.spyOn(mediaStorage, "signUploadUrl");
      const response = await app.inject({
        method: "POST",
        url: "/v1/media/upload-url",
        headers: { authorization: "Bearer valid" },
        payload: { purpose: "food", mimeType: "image/jpeg", byteSize: 100 },
      });
      expect(response.statusCode).toBe(tier === "paid" ? 200 : 403);
      expect(upload).toHaveBeenCalledTimes(tier === "paid" ? 1 : 0);
    }
  });
  it("issues a signed upload URL and records the asset", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const response = await app.inject({
      method: "POST",
      url: "/v1/media/upload-url",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        purpose: "progress",
        mimeType: "image/jpeg",
        byteSize: 1024,
        width: 1024,
        height: 1024,
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.assetId).toBe("string");
    expect(body.objectPath.startsWith(`${userA}/`)).toBe(true);
    expect(typeof body.uploadUrl).toBe("string");
    expect(typeof body.expiresAt).toBe("string");

    // The asset is in the repository now.
    const stored = await mediaAssetRepository.getById(body.assetId, {
      accessToken: "test-token",
    });
    expect(stored).not.toBeNull();
    expect(stored?.userId).toBe(userA);
    expect(stored?.purpose).toBe("progress");
  });

  it("rejects an unsupported mime type with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/media/upload-url",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        purpose: "progress",
        mimeType: "image/gif",
        byteSize: 1024,
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects a byte size above the bucket cap with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/media/upload-url",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        purpose: "progress",
        mimeType: "image/jpeg",
        byteSize: 16 * 1024 * 1024,
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it("rejects an out-of-range dimension with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/media/upload-url",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        purpose: "progress",
        mimeType: "image/jpeg",
        byteSize: 1024,
        width: 1,
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it("returns 401 without a bearer token", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/media/upload-url",
      headers: { "content-type": "application/json" },
      payload: {
        purpose: "progress",
        mimeType: "image/jpeg",
        byteSize: 1024,
      },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("POST /v1/media/upload-url limits (SEC-02)", () => {
  const ticket = (
    app: ReturnType<typeof buildApp>,
    byteSize = 1024,
    token = "valid",
  ) =>
    app.inject({
      method: "POST",
      url: "/v1/media/upload-url",
      headers: { authorization: `Bearer ${token}` },
      payload: { purpose: "progress", mimeType: "image/jpeg", byteSize },
    });

  it("rate limits tickets per user per minute with a retry hint", async () => {
    let now = Date.parse("2026-10-27T10:00:00Z");
    const limiter = new MediaUploadRateLimiter(
      { perMinute: 2, perDay: 100 },
      () => now,
    );
    const { app, mediaStorage, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
      "free",
      { mediaUploadRateLimiter: limiter },
    );
    const sign = vi.spyOn(mediaStorage, "signUploadUrl");
    const create = vi.spyOn(mediaAssetRepository, "create");
    expect((await ticket(app)).statusCode).toBe(200);
    expect((await ticket(app)).statusCode).toBe(200);
    const limited = await ticket(app);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(limited.json().error).toMatchObject({
      code: "RATE_LIMITED",
      reason: "minute_rate_limit",
      retryAfterSeconds: 60,
    });
    // A rejected ticket neither signs nor records an asset.
    expect(sign).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(2);
    now += 60_001;
    expect((await ticket(app)).statusCode).toBe(200);
  });

  it("enforces the daily cap until the next UTC day", async () => {
    let now = Date.parse("2026-10-27T23:59:00Z");
    const limiter = new MediaUploadRateLimiter(
      { perMinute: 100, perDay: 1 },
      () => now,
    );
    const { app } = build(tokenVerifierFor({ userId: userA }), "free", {
      mediaUploadRateLimiter: limiter,
    });
    expect((await ticket(app)).statusCode).toBe(200);
    const limited = await ticket(app);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatchObject({
      code: "RATE_LIMITED",
      reason: "daily_budget_exhausted",
      retryAfterSeconds: 60,
    });
    now = Date.parse("2026-10-28T00:00:01Z");
    expect((await ticket(app)).statusCode).toBe(200);
  });

  it("keeps each user's rate limit separate", async () => {
    const now = Date.parse("2026-10-27T10:00:00Z");
    const limiter = new MediaUploadRateLimiter(
      { perMinute: 1, perDay: 100 },
      () => now,
    );
    const verifier: AccessTokenVerifier = {
      verify: async (token) =>
        token === "a" || token === "b"
          ? {
              userId: token === "a" ? userA : userB,
              role: "authenticated",
              accessToken: `token-${token}`,
            }
          : null,
    };
    const { app } = build(verifier, "free", {
      mediaUploadRateLimiter: limiter,
    });
    expect((await ticket(app, 1024, "a")).statusCode).toBe(200);
    expect((await ticket(app, 1024, "a")).statusCode).toBe(429);
    expect((await ticket(app, 1024, "b")).statusCode).toBe(200);
  });

  it("refuses a ticket with a clear error when the storage quota is full", async () => {
    const allows = vi.fn<MediaQuota["allows"]>(
      async (_userId, byteSize) => byteSize <= 500,
    );
    const { app, mediaStorage, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
      "free",
      { mediaQuota: { allows } },
    );
    const sign = vi.spyOn(mediaStorage, "signUploadUrl");
    const create = vi.spyOn(mediaAssetRepository, "create");
    expect((await ticket(app, 500)).statusCode).toBe(200);
    const full = await ticket(app, 501);
    expect(full.statusCode).toBe(413);
    expect(full.json().error).toMatchObject({
      code: "STORAGE_QUOTA_EXCEEDED",
      message:
        "Your photo storage is full. Remove some photos or backups, then try again.",
    });
    expect(allows).toHaveBeenLastCalledWith(userA, 501, {
      accessToken: "test-token",
    });
    expect(sign).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("GET /v1/media", () => {
  it("returns the user's non-deleted assets newest-first", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      createdAt: new Date("2026-07-10T08:00:00Z"),
      purpose: "progress",
    });
    seedAsset(mediaAssetRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      createdAt: new Date("2026-07-12T08:00:00Z"),
      purpose: "food",
    });
    seedAsset(mediaAssetRepository, {
      id: "00000000-0000-4000-8000-00000000a003",
      createdAt: new Date("2026-07-09T08:00:00Z"),
      deletedAt: new Date("2026-07-13T00:00:00Z"),
      purpose: "profile",
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/media",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const ids = response.json().assets.map((a: { id: string }) => a.id);
    // newest-first, deleted omitted
    expect(ids).toEqual([
      "00000000-0000-4000-8000-00000000a002",
      "00000000-0000-4000-8000-00000000a001",
    ]);
  });

  it("filters by `purpose`", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      purpose: "progress",
    });
    seedAsset(mediaAssetRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      purpose: "food",
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/media?purpose=food",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().assets).toHaveLength(1);
    expect(response.json().assets[0].purpose).toBe("food");
  });

  it("never returns another user's assets", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository);
    const { app: appB } = build(tokenVerifierFor({ userId: userB }));
    const response = await appB.inject({
      method: "GET",
      url: "/v1/media",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().assets).toEqual([]);
  });

  it("rejects an out-of-range `limit` with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/media?limit=999",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(422);
  });
});

describe("POST /v1/media/sign", () => {
  it("blocks Free food signing, timeline, and compare while allowing removal", async () => {
    const { app, mediaAssetRepository, mediaStorage } = build(
      tokenVerifierFor({ userId: userA }),
    );
    const asset = seedAsset(mediaAssetRepository, { purpose: "food" });
    const second = seedAsset(mediaAssetRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      purpose: "food",
    });
    const sign = vi.spyOn(mediaStorage, "signDownloadUrl");
    for (const input of [
      {
        method: "POST" as const,
        url: "/v1/media/sign",
        payload: { assetId: asset.id },
      },
      { method: "GET" as const, url: "/v1/media/timeline?purpose=food" },
      {
        method: "POST" as const,
        url: "/v1/media/compare",
        payload: { assetIdA: asset.id, assetIdB: second.id },
      },
    ])
      expect(
        (
          await app.inject({
            ...input,
            headers: { authorization: "Bearer valid" },
          })
        ).statusCode,
      ).toBe(403);
    expect(sign).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/media/${asset.id}`,
          headers: { authorization: "Bearer valid" },
        })
      ).statusCode,
    ).toBe(204);
  });
  it("issues a signed download URL for an owned asset", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository);
    const response = await app.inject({
      method: "POST",
      url: "/v1/media/sign",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { assetId: "00000000-0000-4000-8000-00000000a001" },
    });
    expect(response.statusCode).toBe(200);
    expect(typeof response.json().signedUrl).toBe("string");
    expect(typeof response.json().expiresAt).toBe("string");
  });

  it("returns 404 when another user's asset id is supplied", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository);
    const { app: appB } = build(tokenVerifierFor({ userId: userB }));
    const response = await appB.inject({
      method: "POST",
      url: "/v1/media/sign",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { assetId: "00000000-0000-4000-8000-00000000a001" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 410 when the asset has been soft-deleted", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository, {
      deletedAt: new Date("2026-07-15T00:00:00Z"),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/media/sign",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: { assetId: "00000000-0000-4000-8000-00000000a001" },
    });
    expect(response.statusCode).toBe(410);
  });
});

describe("DELETE /v1/media/:id", () => {
  it("soft-deletes the asset and removes the storage bytes", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository);
    const response = await app.inject({
      method: "DELETE",
      url: "/v1/media/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(204);
    const after = await mediaAssetRepository.getById(
      "00000000-0000-4000-8000-00000000a001",
      { accessToken: "test-token" },
    );
    expect(after?.deletedAt).not.toBeNull();
    // A subsequent list omits it.
    const list = await app.inject({
      method: "GET",
      url: "/v1/media",
      headers: { authorization: "Bearer valid" },
    });
    expect(list.json().assets).toHaveLength(0);
  });

  it("returns 404 when another user tries to delete", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository);
    const close: Promise<void>[] = apps.map((a) => a.close());
    await Promise.all(close);
    apps.length = 0;
    const second = build(tokenVerifierFor({ userId: userB }));
    const response = await second.app.inject({
      method: "DELETE",
      url: "/v1/media/00000000-0000-4000-8000-00000000a001",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 404 for a non-UUID id", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "DELETE",
      url: "/v1/media/not-a-uuid",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /v1/media/timeline", () => {
  it("returns per-day buckets newest-first within each day", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      createdAt: new Date("2026-07-10T08:00:00Z"),
      purpose: "progress",
    });
    seedAsset(mediaAssetRepository, {
      id: "00000000-0000-4000-8000-00000000a002",
      createdAt: new Date("2026-07-10T20:00:00Z"),
      purpose: "progress",
    });
    seedAsset(mediaAssetRepository, {
      id: "00000000-4000-4000-8000-00000000a003",
      createdAt: new Date("2026-07-12T08:00:00Z"),
      purpose: "progress",
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/media/timeline?from=2026-07-10&to=2026-07-12",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.buckets.map((b: { date: string }) => b.date)).toEqual([
      "2026-07-10",
      "2026-07-12",
    ]);
    expect(body.buckets[0].entryCount).toBe(2);
    expect(body.buckets[0].entries[0].asset.id).toBe(
      "00000000-0000-4000-8000-00000000a002",
    );
    expect(body.buckets[0].entries[1].asset.id).toBe(
      "00000000-0000-4000-8000-00000000a001",
    );
    // Each entry carries a signed URL with an expiry.
    expect(typeof body.buckets[0].entries[0].signedUrl).toBe("string");
    expect(typeof body.buckets[0].entries[0].signedUrlExpiresAt).toBe("string");
  });

  it("defaults to purpose=progress when not specified", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository, {
      purpose: "food",
      createdAt: new Date("2026-07-10T08:00:00Z"),
    });
    seedAsset(mediaAssetRepository, {
      id: "00000000-4000-4000-8000-00000000a002",
      purpose: "progress",
      createdAt: new Date("2026-07-10T09:00:00Z"),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/media/timeline?from=2026-07-10&to=2026-07-10",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().buckets[0].entries).toHaveLength(1);
    expect(response.json().buckets[0].entries[0].asset.purpose).toBe(
      "progress",
    );
  });

  it("omits soft-deleted assets", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository, {
      createdAt: new Date("2026-07-10T08:00:00Z"),
      deletedAt: new Date("2026-07-10T09:00:00Z"),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/media/timeline?from=2026-07-10&to=2026-07-10",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().buckets).toEqual([]);
  });

  it("never returns another user's assets", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository, {
      userId: userB,
      purpose: "progress",
      createdAt: new Date("2026-07-10T08:00:00Z"),
    });
    const { app: appB } = build(tokenVerifierFor({ userId: userB }));
    const response = await appB.inject({
      method: "GET",
      url: "/v1/media/timeline?from=2026-07-10&to=2026-07-10",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().buckets).toEqual([]);
  });

  it("rejects `from > to` with a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/media/timeline?from=2026-07-15&to=2026-07-10",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(422);
  });

  it("returns an out-of-range `limit` rejection as a 422", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/media/timeline?limit=999",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.statusCode).toBe(422);
  });

  it("echoes the signed URL TTL the client can use for cache control", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/media/timeline",
      headers: { authorization: "Bearer valid" },
    });
    expect(response.json().signedUrlTtlSeconds).toBeGreaterThan(0);
  });
});

describe("POST /v1/media/compare", () => {
  it("returns both assets side-by-side with a relative-time delta", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      createdAt: new Date("2026-07-10T08:00:00Z"),
    });
    seedAsset(mediaAssetRepository, {
      id: "00000000-4000-4000-8000-00000000a002",
      createdAt: new Date("2026-07-17T08:00:00Z"),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/media/compare",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        assetIdA: "00000000-0000-4000-8000-00000000a001",
        assetIdB: "00000000-4000-4000-8000-00000000a002",
      },
    });
    if (response.statusCode !== 200) {
      // eslint-disable-next-line no-console
      console.error("DEBUG compare body:", response.body);
    }
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.sideA.asset.id).toBe("00000000-0000-4000-8000-00000000a001");
    expect(body.sideB.asset.id).toBe("00000000-4000-4000-8000-00000000a002");
    expect(body.daysBetween).toBe(7);
    expect(body.direction).toBe("a_before_b");
    // Each side carries a signed URL.
    expect(typeof body.sideA.signedUrl).toBe("string");
    expect(typeof body.sideB.signedUrl).toBe("string");
  });

  it("reports a_after_b when a is the newer asset", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
      createdAt: new Date("2026-07-17T08:00:00Z"),
    });
    seedAsset(mediaAssetRepository, {
      id: "00000000-4000-4000-8000-00000000a002",
      createdAt: new Date("2026-07-10T08:00:00Z"),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/media/compare",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        assetIdA: "00000000-0000-4000-8000-00000000a001",
        assetIdB: "00000000-4000-4000-8000-00000000a002",
      },
    });
    expect(response.json().direction).toBe("a_after_b");
  });

  it("returns 404 when either asset belongs to another user", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
    });
    seedAsset(mediaAssetRepository, {
      id: "00000000-4000-4000-8000-00000000a002",
      userId: userB,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/media/compare",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        assetIdA: "00000000-0000-4000-8000-00000000a001",
        assetIdB: "00000000-4000-4000-8000-00000000a002",
      },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 404 when either asset is soft-deleted", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository, {
      id: "00000000-0000-4000-8000-00000000a001",
    });
    seedAsset(mediaAssetRepository, {
      id: "00000000-4000-4000-8000-00000000a002",
      deletedAt: new Date("2026-07-15T00:00:00Z"),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/media/compare",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        assetIdA: "00000000-0000-4000-8000-00000000a001",
        assetIdB: "00000000-4000-4000-8000-00000000a002",
      },
    });
    expect(response.statusCode).toBe(404);
  });

  it("rejects the same id in both fields with a 422", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository);
    const response = await app.inject({
      method: "POST",
      url: "/v1/media/compare",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        assetIdA: "00000000-0000-4000-8000-00000000a001",
        assetIdB: "00000000-0000-4000-8000-00000000a001",
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it("rejects an unknown field with a 422", async () => {
    const { app, mediaAssetRepository } = build(
      tokenVerifierFor({ userId: userA }),
    );
    seedAsset(mediaAssetRepository);
    seedAsset(mediaAssetRepository, {
      id: "00000000-4000-4000-8000-00000000a002",
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/media/compare",
      headers: {
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      payload: {
        assetIdA: "00000000-0000-4000-8000-00000000a001",
        assetIdB: "00000000-4000-4000-8000-00000000a002",
        mystery: "x",
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it("returns 401 without a bearer token", async () => {
    const { app } = build(tokenVerifierFor({ userId: userA }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/media/compare",
      headers: { "content-type": "application/json" },
      payload: {
        assetIdA: "00000000-0000-4000-8000-00000000a001",
        assetIdB: "00000000-4000-4000-8000-00000000a002",
      },
    });
    expect(response.statusCode).toBe(401);
  });
});
