import { z } from "zod";

/**
 * GET /v1/photo-backups — the caller's private photos that still have a
 * server copy, so the phone can download any it lacks before removing
 * the backups. Each list is newest first and capped at
 * `PHOTO_BACKUP_LIST_LIMIT`; `truncated` means more remain and the client
 * should list again after removing this page.
 */
export const PHOTO_BACKUP_LIST_LIMIT = 2000;

export const mealPhotoBackupSchema = z
  .object({
    entryId: z.string().uuid(),
    assetId: z.string().uuid(),
  })
  .strict();

export const boulderPhotoBackupSchema = z
  .object({
    ascentId: z.string().uuid(),
    sessionId: z.string().uuid(),
    assetId: z.string().uuid(),
  })
  .strict();

export const photoBackupListResponseSchema = z
  .object({
    meals: z.array(mealPhotoBackupSchema).max(PHOTO_BACKUP_LIST_LIMIT),
    boulders: z.array(boulderPhotoBackupSchema).max(PHOTO_BACKUP_LIST_LIMIT),
    truncated: z.boolean(),
  })
  .strict();

export type MealPhotoBackupRecord = z.infer<typeof mealPhotoBackupSchema>;
export type BoulderPhotoBackupRecord = z.infer<typeof boulderPhotoBackupSchema>;
export type PhotoBackupListResponse = z.infer<
  typeof photoBackupListResponseSchema
>;

/**
 * PUT /v1/bouldering/ascents/:id/photo — link an uploaded private
 * `workout` media asset to an existing boulder (back up a device-only
 * photo after the fact). Answers `boulderAscentResponseSchema`.
 */
export const boulderAscentPhotoLinkSchema = z
  .object({ assetId: z.string().uuid() })
  .strict();
export type BoulderAscentPhotoLink = z.infer<
  typeof boulderAscentPhotoLinkSchema
>;
