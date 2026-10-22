import type {
  BoulderPhotoBackup,
  BoulderingRepository,
  FoodEntryRepository,
  MealPhotoBackup,
  MediaAssetRepository,
  PhotoBackupPage,
  PhotoBackupRepository,
  UserId,
} from "@mizyun/core";

/**
 * In-memory `PhotoBackupRepository` for the no-config fallback and route
 * tests. It derives the listing from the other in-memory ports, mirroring
 * the Supabase adapter: owner rows with a photo link whose media asset is
 * owned, of the right purpose and not soft-deleted, newest first.
 */
export class InMemoryPhotoBackupRepository implements PhotoBackupRepository {
  constructor(
    private readonly deps: {
      readonly foodEntries: Pick<FoodEntryRepository, "list">;
      readonly bouldering: Pick<
        BoulderingRepository,
        "listAllSessions" | "listAscents"
      >;
      readonly media: Pick<MediaAssetRepository, "getById">;
    },
  ) {}

  private async live(
    userId: UserId,
    assetId: string,
    purpose: "food" | "workout",
    accessToken: string,
  ): Promise<boolean> {
    const asset = await this.deps.media.getById(assetId, { accessToken });
    return (
      asset !== null &&
      asset.userId === userId &&
      asset.purpose === purpose &&
      asset.deletedAt === null
    );
  }

  async listMealPhotos(
    userId: UserId,
    options: { readonly accessToken: string; readonly limit: number },
  ): Promise<PhotoBackupPage<MealPhotoBackup>> {
    // Test adapter has bounded fixture size; production filters in SQL.
    const entries = (
      await this.deps.foodEntries.list(userId, {
        from: null,
        to: null,
        limit: Number.MAX_SAFE_INTEGER,
        accessToken: options.accessToken,
      })
    ).filter(
      (entry) =>
        entry.userId === userId && typeof entry.photoAssetId === "string",
    );
    const items: MealPhotoBackup[] = [];
    for (const entry of entries.slice(0, options.limit))
      if (
        await this.live(
          userId,
          entry.photoAssetId!,
          "food",
          options.accessToken,
        )
      )
        items.push({ entryId: entry.id, assetId: entry.photoAssetId! });
    return { items, truncated: entries.length > options.limit };
  }

  async listBoulderPhotos(
    userId: UserId,
    options: { readonly accessToken: string; readonly limit: number },
  ): Promise<PhotoBackupPage<BoulderPhotoBackup>> {
    const token = { accessToken: options.accessToken };
    const sessions = await this.deps.bouldering.listAllSessions(userId, token);
    const ascents = (
      await this.deps.bouldering.listAscents(
        userId,
        sessions.map((s) => s.id),
        token,
      )
    )
      .filter((a) => a.userId === userId && a.photoAssetId !== null)
      .sort(
        (a, b) =>
          b.loggedAt.getTime() - a.loggedAt.getTime() ||
          (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      );
    const items: BoulderPhotoBackup[] = [];
    for (const ascent of ascents.slice(0, options.limit))
      if (
        await this.live(
          userId,
          ascent.photoAssetId!,
          "workout",
          options.accessToken,
        )
      )
        items.push({
          ascentId: ascent.id,
          sessionId: ascent.sessionId,
          assetId: ascent.photoAssetId!,
        });
    return { items, truncated: ascents.length > options.limit };
  }
}
