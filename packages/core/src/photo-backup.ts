import type { UserId } from "./index";

/** A saved meal whose ready private photo still has a server copy. */
export interface MealPhotoBackup {
  readonly entryId: string;
  readonly assetId: string;
}

/** A logged boulder whose private `workout` photo still has a server copy. */
export interface BoulderPhotoBackup {
  readonly ascentId: string;
  readonly sessionId: string;
  readonly assetId: string;
}

/** One bounded, newest-first page; `truncated` means more rows remain. */
export interface PhotoBackupPage<T> {
  readonly items: readonly T[];
  readonly truncated: boolean;
}

/**
 * Owner-scoped reads of private photos that are still backed up on the
 * server. Implementations read with the caller's access token (RLS), never
 * with elevated credentials, and exclude soft-deleted media assets.
 */
export interface PhotoBackupRepository {
  listMealPhotos(
    userId: UserId,
    options: { readonly accessToken: string; readonly limit: number },
  ): Promise<PhotoBackupPage<MealPhotoBackup>>;
  listBoulderPhotos(
    userId: UserId,
    options: { readonly accessToken: string; readonly limit: number },
  ): Promise<PhotoBackupPage<BoulderPhotoBackup>>;
}
