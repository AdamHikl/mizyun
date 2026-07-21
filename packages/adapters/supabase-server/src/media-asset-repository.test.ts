import { describe, expect, it, vi } from "vitest";

import type { StoredMediaAsset, UserId } from "@mizyun/core";

import type {
  RepositoryListResult,
  RepositorySingleResult,
  RepositorySupabaseClient,
} from "./index.js";
import { SupabaseMediaAssetRepository } from "./media-asset-repository.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;
const row = {
  id: "00000000-0000-4000-8000-00000000a001",
  user_id: userId,
  bucket_id: "private-media",
  object_path: `${userId}/00000000-0000-4000-8000-00000000a001.jpg`,
  purpose: "progress",
  mime_type: "image/jpeg",
  byte_size: 1024,
  width: 800,
  height: 1200,
  metadata: { captured_on: "2026-07-21" },
  created_at: "2026-07-21T08:00:00.000Z",
  deleted_at: null,
};

const fakeClient = (options: {
  readonly single?: RepositorySingleResult<unknown>;
  readonly maybeSingle?: RepositorySingleResult<unknown>;
  readonly list?: RepositoryListResult<unknown>;
}): RepositorySupabaseClient => ({
  from: () => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      match: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue(options.single),
      maybeSingle: vi.fn().mockResolvedValue(options.maybeSingle),
      then: (resolve: (result: RepositoryListResult<unknown>) => void) => {
        resolve(options.list ?? { data: [], error: null });
      },
    };
    return builder as unknown as never;
  },
  auth: {
    setSession: vi.fn().mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    }),
  },
});

const asset: StoredMediaAsset = {
  id: row.id,
  userId,
  bucketId: row.bucket_id,
  objectPath: row.object_path,
  purpose: "progress",
  mimeType: row.mime_type,
  byteSize: row.byte_size,
  width: row.width,
  height: row.height,
  metadata: row.metadata,
  createdAt: new Date(row.created_at),
  deletedAt: null,
};

describe("SupabaseMediaAssetRepository", () => {
  it("creates and maps a persisted media row", async () => {
    const clientFor = vi.fn(() =>
      fakeClient({ single: { data: row, error: null } }),
    );
    const repository = new SupabaseMediaAssetRepository({ clientFor });

    const result = await repository.create(userId, asset, {
      accessToken: "user-token",
    });

    expect(clientFor).toHaveBeenCalledWith("user-token");
    expect(result).toEqual(asset);
  });

  it("lists only active rows and maps metadata", async () => {
    const repository = new SupabaseMediaAssetRepository({
      clientFor: () => fakeClient({ list: { data: [row], error: null } }),
    });

    const result = await repository.list(userId, {
      purpose: "progress",
      limit: 20,
      accessToken: "user-token",
    });

    expect(result).toEqual([asset]);
  });

  it("returns null when an owned id is not visible", async () => {
    const repository = new SupabaseMediaAssetRepository({
      clientFor: () => fakeClient({ maybeSingle: { data: null, error: null } }),
    });

    await expect(
      repository.getById(row.id, { accessToken: "user-token" }),
    ).resolves.toBeNull();
  });

  it("returns the soft-deleted row", async () => {
    const deletedRow = {
      ...row,
      deleted_at: "2026-07-21T09:00:00.000Z",
    };
    const repository = new SupabaseMediaAssetRepository({
      clientFor: () =>
        fakeClient({ maybeSingle: { data: deletedRow, error: null } }),
    });

    const result = await repository.softDelete(
      row.id,
      new Date(deletedRow.deleted_at),
      { accessToken: "user-token" },
    );

    expect(result?.deletedAt?.toISOString()).toBe(deletedRow.deleted_at);
  });
});
