import type { FastifyPluginAsync } from "fastify";
import {
  buildMediaTimeline,
  buildObjectPath,
  isOwnedMealImagePath,
  compareMediaAssets,
  validateMediaAssetCreate,
  type MediaAssetRepository,
  type MediaAssetValidationError,
  type StoredMediaAsset,
  type UserId,
  type ProfileRepository,
} from "@mizyun/core";
import {
  mediaAssetListResponseSchema,
  mediaAssetResponseSchema,
  mediaCompareRequestSchema,
  mediaCompareResponseSchema,
  mediaListQuerySchema,
  mediaSignRequestSchema,
  mediaSignResponseSchema,
  mediaTimelineQuerySchema,
  mediaTimelineResponseSchema,
  mediaUploadUrlRequestSchema,
  mediaUploadUrlResponseSchema,
  type MediaAssetListResponse,
  type MediaAssetResponse,
  type MediaCompareResponse,
  type MediaSignResponse,
  type MediaTimelineResponse,
  type MediaUploadUrlResponse,
} from "@mizyun/contracts";

import { sendApiError } from "../../errors.js";
import type { MediaStorage } from "../../media-storage.js";
import type { BetaProRepository } from "../../beta-pro-repository.js";
import { hasMealVisuals } from "../../meal-visual-access.js";

interface MediaRoutesOptions {
  readonly mediaAssetRepository: MediaAssetRepository;
  readonly mediaStorage: MediaStorage;
  readonly bucketId: string;
  readonly profileRepository: ProfileRepository;
  readonly betaProRepository: BetaProRepository;
  readonly foodErasureStorage?: MediaStorage;
}

const GENERIC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const SIGNED_URL_TTL_SECONDS = 5 * 60;

/**
 * Map a domain validation failure to the wire contract. Each
 * `MediaAssetValidationError` variant becomes a stable `code`
 * and a human-readable message.
 */
const validationErrorToApi = (
  error: MediaAssetValidationError,
  requestId: string,
): {
  status: number;
  code: "VALIDATION_ERROR";
  message: string;
  requestId: string;
} => {
  switch (error.kind) {
    case "unsupported_mime_type":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "mimeType must be image/jpeg, image/png, or image/webp.",
        requestId,
      };
    case "byte_size_out_of_range":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `byteSize must be between 0 and ${error.max}.`,
        requestId,
      };
    case "dimension_out_of_range":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: `image dimensions must be between ${error.min} and ${error.max}.`,
        requestId,
      };
    case "unsupported_purpose":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "purpose must be food, progress, workout, or profile.",
        requestId,
      };
    case "metadata_must_be_object":
      return {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "metadata must be a JSON object.",
        requestId,
      };
  }
};

const toWire = (asset: StoredMediaAsset): MediaAssetResponse =>
  mediaAssetResponseSchema.parse({
    asset: {
      id: asset.id,
      userId: asset.userId,
      bucketId: asset.bucketId,
      objectPath: asset.objectPath,
      purpose: asset.purpose,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      metadata: { ...asset.metadata },
      createdAt: asset.createdAt.toISOString(),
      deletedAt:
        asset.deletedAt === null ? null : asset.deletedAt.toISOString(),
    },
  });

const listToWire = (
  assets: ReadonlyArray<StoredMediaAsset>,
): MediaAssetListResponse =>
  mediaAssetListResponseSchema.parse({
    assets: assets.map((a) => toWire(a).asset),
  });

/**
 * Pure conversion of a `StoredMediaAsset` to the wire shape
 * (`mediaAssetSchema`). The parse-side Zod schema requires
 * `createdAt` and `updatedAt` as ISO strings; the in-memory
 * repository uses `Date` instances. Centralising the conversion
 * here so every endpoint that embeds an asset uses the same
 * shape.
 */
const toWireAsset = (
  asset: StoredMediaAsset,
): import("@mizyun/contracts").MediaAsset => ({
  id: asset.id,
  userId: asset.userId,
  bucketId: asset.bucketId,
  objectPath: asset.objectPath,
  purpose: asset.purpose,
  mimeType: asset.mimeType,
  byteSize: asset.byteSize,
  width: asset.width,
  height: asset.height,
  metadata: { ...asset.metadata },
  createdAt: asset.createdAt.toISOString(),
  deletedAt: asset.deletedAt === null ? null : asset.deletedAt.toISOString(),
});

export const mediaRoutes: FastifyPluginAsync<MediaRoutesOptions> = async (
  app,
  options,
) => {
  const requireFoodPro = async (
    purpose: string,
    request: Parameters<typeof sendApiError>[1],
    reply: Parameters<typeof sendApiError>[0],
  ) => {
    if (
      purpose !== "food" ||
      (await hasMealVisuals(
        options,
        request.principal!.userId as UserId,
        request.principal!.accessToken,
      ))
    )
      return true;
    await sendApiError(
      reply,
      request,
      403,
      "FORBIDDEN",
      "Meal images require Pro Pass.",
    );
    return false;
  };
  // POST /v1/media/upload-url — issue a signed upload URL and
  // record the asset metadata. The route server-generates the
  // object path so a misconfigured client cannot place bytes
  // outside its own folder.
  app.post(
    "/media/upload-url",
    { preHandler: app.authenticate },
    async (request, reply): Promise<MediaUploadUrlResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const body = request.body as unknown;
      const parsed = mediaUploadUrlRequestSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid media upload request: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const validation = validateMediaAssetCreate({
        purpose: parsed.data.purpose,
        mimeType: parsed.data.mimeType,
        byteSize: parsed.data.byteSize,
        width: parsed.data.width ?? null,
        height: parsed.data.height ?? null,
        ...(parsed.data.metadata !== undefined
          ? { metadata: parsed.data.metadata }
          : {}),
      });
      if (validation !== null) {
        const apiError = validationErrorToApi(validation, request.id);
        await sendApiError(
          reply,
          request,
          apiError.status,
          apiError.code,
          apiError.message,
        );
        return;
      }
      const now = new Date();
      if (!(await requireFoodPro(parsed.data.purpose, request, reply))) return;
      const id = crypto.randomUUID();
      const objectPath = buildObjectPath(
        principal.userId,
        id,
        parsed.data.mimeType,
      );
      const stored: StoredMediaAsset = {
        id,
        userId: principal.userId,
        bucketId: options.bucketId,
        objectPath,
        purpose: parsed.data.purpose,
        mimeType: parsed.data.mimeType,
        byteSize: parsed.data.byteSize,
        width: parsed.data.width ?? null,
        height: parsed.data.height ?? null,
        metadata: parsed.data.metadata ? { ...parsed.data.metadata } : {},
        createdAt: now,
        deletedAt: null,
      };
      const signed = await options.mediaStorage.signUploadUrl(
        options.bucketId,
        objectPath,
        {
          ttlSeconds: SIGNED_URL_TTL_SECONDS,
          now,
          accessToken: principal.accessToken,
        },
      );
      await options.mediaAssetRepository.create(principal.userId, stored, {
        accessToken: principal.accessToken,
      });
      if (!(await requireFoodPro(stored.purpose, request, reply))) return;
      return mediaUploadUrlResponseSchema.parse({
        assetId: id,
        uploadUrl: signed.url,
        objectPath,
        expiresAt: signed.expiresAt.toISOString(),
      });
    },
  );

  // GET /v1/media — list the user's media assets, newest-first,
  // filtered by an optional purpose.
  app.get(
    "/media",
    { preHandler: app.authenticate },
    async (request, reply): Promise<MediaAssetListResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const parsed = mediaListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid media list query: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const limit = Math.min(
        MAX_LIMIT,
        Math.max(1, parsed.data.limit ?? DEFAULT_LIMIT),
      );
      const assets = await options.mediaAssetRepository.list(principal.userId, {
        purpose: parsed.data.purpose ?? null,
        limit,
        accessToken: principal.accessToken,
      });
      return listToWire(assets);
    },
  );

  // POST /v1/media/sign — issue a short-lived signed download URL
  // for an existing asset. Ownership is enforced at the route
  // layer; a deleted asset returns 410.
  app.post(
    "/media/sign",
    { preHandler: app.authenticate },
    async (request, reply): Promise<MediaSignResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const body = request.body as unknown;
      const parsed = mediaSignRequestSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid media sign request: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const asset = await options.mediaAssetRepository.getById(
        parsed.data.assetId,
        { accessToken: principal.accessToken },
      );
      if (asset === null || asset.userId !== principal.userId) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No media asset with that id exists for this user.",
        );
        return;
      }
      if (asset.deletedAt !== null) {
        await sendApiError(
          reply,
          request,
          410,
          "NOT_FOUND",
          "That media asset has been deleted.",
        );
        return;
      }
      if (!(await requireFoodPro(asset.purpose, request, reply))) return;
      const signed = await options.mediaStorage.signDownloadUrl(
        options.bucketId,
        asset.objectPath,
        {
          ttlSeconds: SIGNED_URL_TTL_SECONDS,
          now: new Date(),
          accessToken: principal.accessToken,
        },
      );
      if (!(await requireFoodPro(asset.purpose, request, reply))) return;
      reply.header("cache-control", "no-store");
      return mediaSignResponseSchema.parse({
        signedUrl: signed.url,
        expiresAt: signed.expiresAt.toISOString(),
      });
    },
  );

  // DELETE /v1/media/:id — remove the sensitive bytes first, then
  // soft-delete the metadata row. If the metadata update fails, a retry
  // sees the row and repeats the idempotent object removal; this avoids
  // leaving private bytes behind an already-hidden metadata row.
  app.delete(
    "/media/:id",
    { preHandler: app.authenticate },
    async (request, reply): Promise<void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const { id } = request.params as { id?: string };
      if (typeof id !== "string" || !GENERIC_UUID.test(id)) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Media asset id must be a UUID.",
        );
        return;
      }
      const asset = await options.mediaAssetRepository.getById(id, {
        accessToken: principal.accessToken,
      });
      if (asset === null || asset.userId !== principal.userId) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "No media asset with that id exists for this user.",
        );
        return;
      }
      const now = new Date();
      const erasureStorage =
        asset.purpose === "food"
          ? isOwnedMealImagePath(
              principal.userId,
              asset.bucketId,
              asset.objectPath,
            )
            ? (options.foodErasureStorage ?? options.mediaStorage)
            : null
          : options.mediaStorage;
      if (erasureStorage)
        await erasureStorage.remove(options.bucketId, asset.objectPath, {
          accessToken: principal.accessToken,
        });
      const updated = await options.mediaAssetRepository.softDelete(id, now, {
        accessToken: principal.accessToken,
      });
      if (updated === null) {
        // Race: someone else just deleted it. Return 204 — the
        // caller's intent (the asset is gone) holds.
        void reply.status(204).send();
        return;
      }
      void reply.status(204).send();
    },
  );

  // GET /v1/media/timeline — return the user's assets in
  // per-day buckets, oldest-first. Each entry carries a
  // short-lived signed download URL so the UI can render
  // thumbnails without a second round-trip. The default
  // `purpose` is `progress` (BODY-04); callers filter to a
  // different purpose explicitly when needed.
  app.get(
    "/media/timeline",
    { preHandler: app.authenticate },
    async (request, reply): Promise<MediaTimelineResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const parsed = mediaTimelineQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid media timeline query: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const purpose = parsed.data.purpose ?? "progress";
      if (!(await requireFoodPro(purpose, request, reply))) return;
      const limit = Math.min(
        MAX_LIMIT,
        Math.max(1, parsed.data.limit ?? DEFAULT_LIMIT),
      );
      // The list repo doesn't expose a date-range filter today
      // (the SQL query has no `from`/`to` predicate), so we pull
      // a generous page and bucket client-side. A future segment
      // adds `from`/`to` to the repository when the SQL adapter
      // lands and the index on `(user_id, created_at desc)` can
      // serve the predicate cheaply.
      const all = await options.mediaAssetRepository.list(principal.userId, {
        purpose,
        limit: MAX_LIMIT,
        accessToken: principal.accessToken,
      });
      // Default window: last 365 days when no bounds supplied.
      const now = new Date();
      const oneYearMs = 365 * 24 * 60 * 60 * 1000;
      const defaultFrom = new Date(now.getTime() - oneYearMs);
      const fromIso = parsed.data.from
        ? parsed.data.from
        : `${defaultFrom.getUTCFullYear()}-${(defaultFrom.getUTCMonth() + 1)
            .toString()
            .padStart(
              2,
              "0",
            )}-${defaultFrom.getUTCDate().toString().padStart(2, "0")}`;
      const toIso = parsed.data.to
        ? parsed.data.to
        : `${now.getUTCFullYear()}-${(now.getUTCMonth() + 1)
            .toString()
            .padStart(2, "0")}-${now.getUTCDate().toString().padStart(2, "0")}`;

      const filtered = all.filter((asset) => {
        const ms = asset.createdAt.getTime();
        const fromMs = Date.parse(`${fromIso}T00:00:00Z`);
        const toMs = Date.parse(`${toIso}T23:59:59.999Z`);
        return ms >= fromMs && ms <= toMs;
      });

      let buckets;
      try {
        buckets = buildMediaTimeline(filtered, {
          from: fromIso,
          to: toIso,
        });
      } catch (e) {
        // buildMediaTimeline is pure; this catch is defensive
        // (the function doesn't throw today but a future
        // re-shape shouldn't crash the route).
        throw e;
      }
      // After bucketing, cap the total entry count by trimming
      // the oldest buckets first. The newest days are the ones
      // the UI surfaces first.
      let remaining = limit;
      const trimmed: Array<{
        date: string;
        entryCount: number;
        entries: Array<{
          asset: StoredMediaAsset;
          signedUrl: string;
          signedUrlExpiresAt: string;
        }>;
      }> = [];
      for (const bucket of buckets) {
        if (remaining <= 0) break;
        const kept = bucket.entries.slice(0, remaining);
        if (kept.length === 0) continue;
        const entries: Array<{
          asset: StoredMediaAsset;
          signedUrl: string;
          signedUrlExpiresAt: string;
        }> = [];
        for (const asset of kept) {
          if (!(await requireFoodPro(asset.purpose, request, reply))) return;
          const signed = await options.mediaStorage.signDownloadUrl(
            options.bucketId,
            asset.objectPath,
            {
              ttlSeconds: SIGNED_URL_TTL_SECONDS,
              now,
              accessToken: principal.accessToken,
            },
          );
          entries.push({
            asset,
            signedUrl: signed.url,
            signedUrlExpiresAt: signed.expiresAt.toISOString(),
          });
        }
        trimmed.push({
          date: bucket.date,
          entryCount: entries.length,
          entries,
        });
        remaining -= entries.length;
      }
      try {
        if (!(await requireFoodPro(purpose, request, reply))) return;
        reply.header("cache-control", "no-store");
        return mediaTimelineResponseSchema.parse({
          buckets: trimmed.map((bucket) => ({
            date: bucket.date,
            entryCount: bucket.entryCount,
            entries: bucket.entries.map((entry) => ({
              asset: toWireAsset(entry.asset),
              signedUrl: entry.signedUrl,
              signedUrlExpiresAt: entry.signedUrlExpiresAt,
            })),
          })),
          signedUrlTtlSeconds: SIGNED_URL_TTL_SECONDS,
        });
      } catch (e) {
        // The parse is a self-check on data we just constructed;
        // if it ever throws, the in-memory repos are returning
        // shapes that don't match the wire contract — that is
        // a bug, not a 5xx-worthy runtime condition, so we
        // re-throw and let the global handler surface it.
        throw e;
      }
    },
  );

  // POST /v1/media/compare — return two assets side-by-side with
  // a relative-time delta. Ownership of both ids is enforced; a
  // missing or cross-user id returns 404. The two sides are
  // returned in the order the caller requested (so the UI can
  // render "before/after" with `a` on the left).
  app.post(
    "/media/compare",
    { preHandler: app.authenticate },
    async (request, reply): Promise<MediaCompareResponse | void> => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      const body = request.body as unknown;
      const parsed = mediaCompareRequestSchema.safeParse(body);
      if (!parsed.success) {
        await sendApiError(
          reply,
          request,
          422,
          "VALIDATION_ERROR",
          `Invalid media compare request: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
        );
        return;
      }
      const [a, b] = await Promise.all([
        options.mediaAssetRepository.getById(parsed.data.assetIdA, {
          accessToken: principal.accessToken,
        }),
        options.mediaAssetRepository.getById(parsed.data.assetIdB, {
          accessToken: principal.accessToken,
        }),
      ]);
      if (
        a === null ||
        b === null ||
        a.userId !== principal.userId ||
        b.userId !== principal.userId ||
        a.deletedAt !== null ||
        b.deletedAt !== null
      ) {
        await sendApiError(
          reply,
          request,
          404,
          "NOT_FOUND",
          "Both asset ids must belong to this user and not be deleted.",
        );
        return;
      }
      const ttl =
        parsed.data.urlTtlSeconds && parsed.data.urlTtlSeconds > 0
          ? parsed.data.urlTtlSeconds
          : SIGNED_URL_TTL_SECONDS;
      const now = new Date();
      if (
        !(await requireFoodPro(a.purpose, request, reply)) ||
        !(await requireFoodPro(b.purpose, request, reply))
      )
        return;
      const [signedA, signedB] = await Promise.all([
        options.mediaStorage.signDownloadUrl(options.bucketId, a.objectPath, {
          ttlSeconds:
            a.purpose === "food" ? Math.min(ttl, SIGNED_URL_TTL_SECONDS) : ttl,
          now,
          accessToken: principal.accessToken,
        }),
        options.mediaStorage.signDownloadUrl(options.bucketId, b.objectPath, {
          ttlSeconds:
            b.purpose === "food" ? Math.min(ttl, SIGNED_URL_TTL_SECONDS) : ttl,
          now,
          accessToken: principal.accessToken,
        }),
      ]);
      const { daysBetween, direction } = compareMediaAssets(a, b);
      if (
        !(await requireFoodPro(a.purpose, request, reply)) ||
        !(await requireFoodPro(b.purpose, request, reply))
      )
        return;
      reply.header("cache-control", "no-store");
      return mediaCompareResponseSchema.parse({
        sideA: {
          asset: toWireAsset(a),
          signedUrl: signedA.url,
          signedUrlExpiresAt: signedA.expiresAt.toISOString(),
        },
        sideB: {
          asset: toWireAsset(b),
          signedUrl: signedB.url,
          signedUrlExpiresAt: signedB.expiresAt.toISOString(),
        },
        daysBetween,
        direction,
      });
    },
  );
};

// Re-export the UserId type for downstream callers (the
// `apps/api/src/app.ts` composition root doesn't import from
// `@mizyun/core` directly here so the explicit re-export keeps
// the dependency tree tidy).
export type { UserId };
