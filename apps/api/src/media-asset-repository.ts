import type {
  MediaAssetRepository,
  MediaPurpose,
  StoredMediaAsset,
  UserId,
} from "@mizyun/core";

/**
 * In-memory implementation of the `MediaAssetRepository` port.
 *
 * Used by `apps/api` until the Supabase adapter lands. Behaviour:
 *   - `create` stores the asset under the user's tenant partition;
 *     the storage coordinates (`bucketId`, `objectPath`) are
 *     server-generated at the route layer and passed in.
 *   - `list` filters by tenant + optional `purpose`, returns
 *     newest-first, capped at `limit`.
 *   - `softDelete` sets `deletedAt = now` and returns the row;
 *     the route asks the storage layer to remove the bytes.
 *
 * The repository deliberately does not enforce RLS — the SQL
 * policies on `public.media_assets` are the source of truth.
 */
export class InMemoryMediaAssetRepository implements MediaAssetRepository {
  readonly #byId = new Map<string, StoredMediaAsset>();
  readonly #byUser = new Map<UserId, StoredMediaAsset[]>();

  async create(
    userId: UserId,
    asset: StoredMediaAsset,
  ): Promise<StoredMediaAsset> {
    if (asset.userId !== userId) {
      throw new Error("media asset create userId mismatch");
    }
    if (this.#byId.has(asset.id)) {
      throw new Error(`media asset id collision ${asset.id}`);
    }
    this.#byId.set(asset.id, asset);
    const list = this.#byUser.get(userId) ?? [];
    this.#byUser.set(userId, [...list, asset]);
    return asset;
  }

  async list(
    userId: UserId,
    options: {
      readonly purpose: MediaPurpose | null;
      readonly limit: number;
    },
  ): Promise<ReadonlyArray<StoredMediaAsset>> {
    const list = this.#byUser.get(userId) ?? [];
    const filtered = list.filter((asset) => {
      if (asset.deletedAt !== null) return false;
      if (options.purpose !== null && asset.purpose !== options.purpose) {
        return false;
      }
      return true;
    });
    return [...filtered]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, Math.max(0, options.limit));
  }

  async getById(id: string): Promise<StoredMediaAsset | null> {
    return this.#byId.get(id) ?? null;
  }

  async softDelete(id: string, now: Date): Promise<StoredMediaAsset | null> {
    const existing = this.#byId.get(id);
    if (existing === undefined) return null;
    const updated: StoredMediaAsset = { ...existing, deletedAt: now };
    this.#byId.set(id, updated);
    const owner = existing.userId;
    const list = this.#byUser.get(owner) ?? [];
    this.#byUser.set(
      owner,
      list.map((asset) => (asset.id === id ? updated : asset)),
    );
    return updated;
  }

  /** Test-only helper that pre-seeds an asset for a user. */
  __seedForTest(asset: StoredMediaAsset): void {
    this.#byId.set(asset.id, asset);
    const list = this.#byUser.get(asset.userId) ?? [];
    this.#byUser.set(asset.userId, [...list, asset]);
  }
}
