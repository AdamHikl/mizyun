import type { FastifyPluginAsync } from "fastify";
import type { PhotoBackupRepository, UserId } from "@mizyun/core";
import {
  PHOTO_BACKUP_LIST_LIMIT,
  photoBackupListResponseSchema,
  type PhotoBackupListResponse,
} from "@mizyun/contracts";
import { sendApiError } from "../../errors.js";

/**
 * GET /v1/photo-backups — the caller's meal and boulder photos that still
 * have a server copy, so the phone can download any it lacks and then
 * remove each backup (`DELETE /v1/food-entries/:id/photo`,
 * `DELETE /v1/bouldering/ascents/:id/photo`).
 *
 * Deliberately not Pro-gated and not behind the bouldering or meal-photo
 * feature flags: finding and erasing one's own backed-up photos must keep
 * working after a downgrade or a feature switch-off. Meals are listed only
 * when meal-photo storage is configured, because without it there is no
 * server copy to erase.
 */
export const photoBackupRoutes: FastifyPluginAsync<{
  repository: PhotoBackupRepository;
  /** False when no meal-photo service is configured; meals then list empty. */
  mealPhotosAvailable: boolean;
}> = async (app, { repository, mealPhotosAvailable }) => {
  app.get(
    "/photo-backups",
    { preHandler: app.authenticate },
    async (request, reply): Promise<PhotoBackupListResponse | void> => {
      const principal = request.principal!;
      const userId = principal.userId as UserId;
      const options = {
        accessToken: principal.accessToken,
        limit: PHOTO_BACKUP_LIST_LIMIT,
      };
      try {
        const [meals, boulders] = await Promise.all([
          mealPhotosAvailable
            ? repository.listMealPhotos(userId, options)
            : { items: [], truncated: false },
          repository.listBoulderPhotos(userId, options),
        ]);
        const body = photoBackupListResponseSchema.parse({
          meals: meals.items.map((m) => ({
            entryId: m.entryId,
            assetId: m.assetId,
          })),
          boulders: boulders.items.map((b) => ({
            ascentId: b.ascentId,
            sessionId: b.sessionId,
            assetId: b.assetId,
          })),
          truncated: meals.truncated || boulders.truncated,
        });
        reply.header("cache-control", "no-store");
        return body;
      } catch (error) {
        request.log.error(
          { errorName: error instanceof Error ? error.name : "unknown" },
          "photo backup listing failed",
        );
        await sendApiError(
          reply,
          request,
          503,
          "SERVICE_UNAVAILABLE",
          "Photo backups are unavailable. Retry shortly.",
        );
      }
    },
  );
};
