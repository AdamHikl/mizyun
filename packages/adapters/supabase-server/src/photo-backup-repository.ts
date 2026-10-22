import type {
  BoulderPhotoBackup,
  MealPhotoBackup,
  PhotoBackupPage,
  PhotoBackupRepository,
  UserId,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

interface FoodPhotoRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly photo_asset_id: string | null;
  readonly consumed_at: string;
}

interface AscentPhotoRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly workout_id: string;
  readonly photo_asset_id: string | null;
  readonly logged_at: string;
}

interface AssetLiveRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly purpose: string;
  readonly deleted_at: string | null;
}

const ID_CHUNK = 100;

/**
 * Owner-scoped photo backup listing. Every read uses the caller's access
 * token, so RLS (`user_id = auth.uid()`) bounds the rows; the explicit
 * `user_id` filter and row check are defense in depth.
 *
 * Meals are read from `food_entries.photo_asset_id` rather than
 * `meal_photos`: the database only lets that column reference a `ready`
 * meal photo of the same meal and clears it when the photo is revoked or
 * its asset soft-deleted, and it stays readable after Pro lapses (the
 * `meal_photos` read policy is Pro-only, but erasure must not be).
 */
export class SupabasePhotoBackupRepository implements PhotoBackupRepository {
  constructor(
    private readonly deps: {
      readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
    },
  ) {}

  /** Ids of the given owner assets of `purpose` that are not soft-deleted. */
  private async liveAssets(
    client: RepositorySupabaseClient,
    userId: UserId,
    ids: readonly string[],
    purpose: "food" | "workout",
  ): Promise<ReadonlySet<string>> {
    const live = new Set<string>();
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += ID_CHUNK) {
      const { data, error } = await client
        .from<AssetLiveRow>("media_assets")
        .select("id,user_id,purpose,deleted_at")
        .eq("user_id", userId)
        .in("id", unique.slice(i, i + ID_CHUNK))
        .is("deleted_at", null);
      if (error || !Array.isArray(data))
        throw new RepositoryError("Photo backups unavailable");
      for (const row of data)
        if (
          row.user_id === userId &&
          row.purpose === purpose &&
          row.deleted_at === null
        )
          live.add(row.id);
    }
    return live;
  }

  async listMealPhotos(
    userId: UserId,
    options: { readonly accessToken: string; readonly limit: number },
  ): Promise<PhotoBackupPage<MealPhotoBackup>> {
    const client = this.deps.clientFor(options.accessToken);
    const { data, error } = await client
      .from<FoodPhotoRow>("food_entries")
      .select("id,user_id,photo_asset_id,consumed_at")
      .eq("user_id", userId)
      .or("photo_asset_id.not.is.null")
      .order("consumed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(options.limit + 1);
    if (error || !Array.isArray(data))
      throw new RepositoryError("Photo backups unavailable");
    if (data.some((row) => row.user_id !== userId))
      throw new RepositoryError("Photo backups unavailable");
    const page = data
      .slice(0, options.limit)
      .filter(
        (row): row is FoodPhotoRow & { photo_asset_id: string } =>
          typeof row.photo_asset_id === "string",
      );
    const live = await this.liveAssets(
      client,
      userId,
      page.map((row) => row.photo_asset_id),
      "food",
    );
    return {
      items: page
        .filter((row) => live.has(row.photo_asset_id))
        .map((row) => ({ entryId: row.id, assetId: row.photo_asset_id })),
      truncated: data.length > options.limit,
    };
  }

  async listBoulderPhotos(
    userId: UserId,
    options: { readonly accessToken: string; readonly limit: number },
  ): Promise<PhotoBackupPage<BoulderPhotoBackup>> {
    const client = this.deps.clientFor(options.accessToken);
    const { data, error } = await client
      .from<AscentPhotoRow>("boulder_ascents")
      .select("id,user_id,workout_id,photo_asset_id,logged_at")
      .eq("user_id", userId)
      .or("photo_asset_id.not.is.null")
      .order("logged_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(options.limit + 1);
    if (error || !Array.isArray(data))
      throw new RepositoryError("Photo backups unavailable");
    if (data.some((row) => row.user_id !== userId))
      throw new RepositoryError("Photo backups unavailable");
    const page = data
      .slice(0, options.limit)
      .filter(
        (row): row is AscentPhotoRow & { photo_asset_id: string } =>
          typeof row.photo_asset_id === "string",
      );
    const live = await this.liveAssets(
      client,
      userId,
      page.map((row) => row.photo_asset_id),
      "workout",
    );
    return {
      items: page
        .filter((row) => live.has(row.photo_asset_id))
        .map((row) => ({
          ascentId: row.id,
          sessionId: row.workout_id,
          assetId: row.photo_asset_id,
        })),
      truncated: data.length > options.limit,
    };
  }
}
