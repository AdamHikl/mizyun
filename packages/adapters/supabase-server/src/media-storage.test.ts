import { describe, expect, it, vi } from "vitest";

import {
  MediaStorageError,
  SupabaseMediaStorage,
  type StorageBucketClient,
  type StorageSupabaseClient,
} from "./media-storage.js";

const fakeClient = (bucket: StorageBucketClient): StorageSupabaseClient => ({
  storage: { from: vi.fn(() => bucket) },
});

describe("SupabaseMediaStorage", () => {
  it("signs uploads with Supabase's fixed two-hour expiry", async () => {
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://storage.test/upload?token=one-time" },
      error: null,
    });
    const bucket = {
      createSignedUploadUrl,
      createSignedUrl: vi.fn(),
      remove: vi.fn(),
    } as unknown as StorageBucketClient;
    const clientFor = vi.fn(() => fakeClient(bucket));
    const storage = new SupabaseMediaStorage({ clientFor });
    const now = new Date("2026-07-21T08:00:00.000Z");

    const result = await storage.signUploadUrl("private-media", "user/a.jpg", {
      ttlSeconds: 300,
      now,
      accessToken: "user-token",
    });

    expect(clientFor).toHaveBeenCalledWith("user-token");
    expect(createSignedUploadUrl).toHaveBeenCalledWith("user/a.jpg", {
      upsert: false,
    });
    expect(result.expiresAt.toISOString()).toBe("2026-07-21T10:00:00.000Z");
  });

  it("passes the requested download TTL and reports its expiry", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://storage.test/download?token=short-lived" },
      error: null,
    });
    const bucket = {
      createSignedUploadUrl: vi.fn(),
      createSignedUrl,
      remove: vi.fn(),
    } as unknown as StorageBucketClient;
    const storage = new SupabaseMediaStorage({
      clientFor: () => fakeClient(bucket),
    });

    const result = await storage.signDownloadUrl(
      "private-media",
      "user/a.jpg",
      {
        ttlSeconds: 90,
        now: new Date("2026-07-21T08:00:00.000Z"),
        accessToken: "user-token",
      },
    );

    expect(createSignedUrl).toHaveBeenCalledWith("user/a.jpg", 90);
    expect(result.expiresAt.toISOString()).toBe("2026-07-21T08:01:30.000Z");
  });

  it("removes through the Storage API and tolerates a missing object", async () => {
    const remove = vi
      .fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "not found", statusCode: 404 },
      });
    const bucket = {
      createSignedUploadUrl: vi.fn(),
      createSignedUrl: vi.fn(),
      remove,
    } as unknown as StorageBucketClient;
    const storage = new SupabaseMediaStorage({
      clientFor: () => fakeClient(bucket),
    });

    await storage.remove("private-media", "user/a.jpg", {
      accessToken: "user-token",
    });
    await expect(
      storage.remove("private-media", "user/a.jpg", {
        accessToken: "user-token",
      }),
    ).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(["user/a.jpg"]);
  });

  it("does not hide non-404 Storage failures", async () => {
    const bucket = {
      createSignedUploadUrl: vi.fn(),
      createSignedUrl: vi.fn(),
      remove: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "forbidden", statusCode: 403 },
      }),
    } as unknown as StorageBucketClient;
    const storage = new SupabaseMediaStorage({
      clientFor: () => fakeClient(bucket),
    });

    await expect(
      storage.remove("private-media", "other/a.jpg", {
        accessToken: "user-token",
      }),
    ).rejects.toBeInstanceOf(MediaStorageError);
  });

  it("rewrites signed upload URL origin to publicUrl when configured", async () => {
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: {
        signedUrl:
          "http://127.0.0.1:8100/storage/v1/object/upload/sign/private-media/user/a.jpg?token=secret-token",
      },
      error: null,
    });
    const bucket = {
      createSignedUploadUrl,
      createSignedUrl: vi.fn(),
      remove: vi.fn(),
    } as unknown as StorageBucketClient;
    const storage = new SupabaseMediaStorage({
      clientFor: () => fakeClient(bucket),
      publicUrl: "https://mizyun-supabase-dev.phiskel.com",
    });

    const result = await storage.signUploadUrl("private-media", "user/a.jpg", {
      ttlSeconds: 300,
      now: new Date("2026-07-21T08:00:00.000Z"),
      accessToken: "user-token",
    });

    expect(result.url).toBe(
      "https://mizyun-supabase-dev.phiskel.com/storage/v1/object/upload/sign/private-media/user/a.jpg?token=secret-token",
    );
  });

  it("rewrites signed download URL origin to publicUrl when configured", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: {
        signedUrl:
          "http://127.0.0.1:8100/storage/v1/object/sign/private-media/user/a.jpg?token=read-token",
      },
      error: null,
    });
    const bucket = {
      createSignedUploadUrl: vi.fn(),
      createSignedUrl,
      remove: vi.fn(),
    } as unknown as StorageBucketClient;
    const storage = new SupabaseMediaStorage({
      clientFor: () => fakeClient(bucket),
      publicUrl: "https://mizyun-supabase.phiskel.com",
    });

    const result = await storage.signDownloadUrl(
      "private-media",
      "user/a.jpg",
      {
        ttlSeconds: 60,
        now: new Date("2026-07-21T08:00:00.000Z"),
        accessToken: "user-token",
      },
    );

    expect(result.url).toBe(
      "https://mizyun-supabase.phiskel.com/storage/v1/object/sign/private-media/user/a.jpg?token=read-token",
    );
  });
});
