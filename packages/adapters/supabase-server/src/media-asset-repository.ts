import type {
  MediaAssetRepository,
  MediaPurpose,
  StoredMediaAsset,
  UserId,
} from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

interface MediaAssetRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly bucket_id: string;
  readonly object_path: string;
  readonly purpose: MediaPurpose;
  readonly mime_type: string;
  readonly byte_size: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
  readonly deleted_at: string | null;
}

export const mediaAssetFromRow = (row: MediaAssetRow): StoredMediaAsset => ({
  id: row.id,
  userId: row.user_id as UserId,
  bucketId: row.bucket_id,
  objectPath: row.object_path,
  purpose: row.purpose,
  mimeType: row.mime_type,
  byteSize: row.byte_size,
  width: row.width,
  height: row.height,
  metadata: { ...row.metadata },
  createdAt: new Date(row.created_at),
  deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at),
});
const fromRow = mediaAssetFromRow;

const toInsertRow = (
  userId: UserId,
  asset: StoredMediaAsset,
): Partial<MediaAssetRow> => ({
  id: asset.id,
  user_id: userId,
  bucket_id: asset.bucketId,
  object_path: asset.objectPath,
  purpose: asset.purpose,
  mime_type: asset.mimeType,
  byte_size: asset.byteSize,
  width: asset.width,
  height: asset.height,
  metadata: { ...asset.metadata },
  created_at: asset.createdAt.toISOString(),
  deleted_at: asset.deletedAt?.toISOString() ?? null,
});

export interface SupabaseMediaAssetRepositoryOptions {
  readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
}

export class SupabaseMediaAssetRepository implements MediaAssetRepository {
  readonly #clientFor: (accessToken: string) => RepositorySupabaseClient;

  constructor(options: SupabaseMediaAssetRepositoryOptions) {
    this.#clientFor = options.clientFor;
  }

  async create(
    userId: UserId,
    asset: StoredMediaAsset,
    options: { readonly accessToken: string },
  ): Promise<StoredMediaAsset> {
    const { data, error } = await this.#clientFor(options.accessToken)
      .from<MediaAssetRow>("media_assets")
      .insert(toInsertRow(userId, asset))
      .select("*")
      .single();
    if (error || data === null) {
      throw new RepositoryError(
        error?.message ?? "media insert returned no row",
      );
    }
    return fromRow(data);
  }

  async list(
    userId: UserId,
    options: {
      readonly purpose: MediaPurpose | null;
      readonly limit: number;
      readonly accessToken: string;
    },
  ): Promise<ReadonlyArray<StoredMediaAsset>> {
    let builder = this.#clientFor(options.accessToken)
      .from<MediaAssetRow>("media_assets")
      .select("*")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(options.limit);
    if (options.purpose !== null) {
      builder = builder.eq("purpose", options.purpose);
    }
    const { data, error } = await builder;
    if (error) throw new RepositoryError(error.message);
    return (data ?? []).map(fromRow);
  }

  async getById(
    id: string,
    options: { readonly accessToken: string },
  ): Promise<StoredMediaAsset | null> {
    const { data, error } = await this.#clientFor(options.accessToken)
      .from<MediaAssetRow>("media_assets")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new RepositoryError(error.message);
    return data === null ? null : fromRow(data);
  }

  async softDelete(
    id: string,
    now: Date,
    options: { readonly accessToken: string },
  ): Promise<StoredMediaAsset | null> {
    const { data, error } = await this.#clientFor(options.accessToken)
      .from<MediaAssetRow>("media_assets")
      .update({ deleted_at: now.toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle();
    if (error) throw new RepositoryError(error.message);
    return data === null ? null : fromRow(data);
  }
}
