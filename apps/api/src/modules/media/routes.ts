import type { FastifyPluginAsync } from "fastify";
import {
  buildObjectPath,
  validateMediaAssetCreate,
  type MediaAssetRepository,
  type MediaAssetValidationError,
  type StoredMediaAsset,
  type UserId,
} from "@mizyun/core";
import {
  mediaAssetListResponseSchema,
  mediaAssetResponseSchema,
  mediaListQuerySchema,
  mediaSignRequestSchema,
  mediaSignResponseSchema,
  mediaUploadUrlRequestSchema,
  mediaUploadUrlResponseSchema,
  type MediaAssetListResponse,
  type MediaAssetResponse,
  type MediaSignResponse,
  type MediaUploadUrlResponse,
} from "@mizyun/contracts";

import { sendApiError } from "../../errors.js";
import type { MediaStorage } from "../../media-storage.js";

interface MediaRoutesOptions {
  readonly mediaAssetRepository: MediaAssetRepository;
  readonly mediaStorage: MediaStorage;
  readonly bucketId: string;
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

export const mediaRoutes: FastifyPluginAsync<MediaRoutesOptions> = async (
  app,
  options,
) => {
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
      await options.mediaAssetRepository.create(principal.userId, stored);
      const signed = await options.mediaStorage.signUploadUrl(
        options.bucketId,
        objectPath,
        { ttlSeconds: SIGNED_URL_TTL_SECONDS, now },
      );
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
      const signed = await options.mediaStorage.signDownloadUrl(
        options.bucketId,
        asset.objectPath,
        { ttlSeconds: SIGNED_URL_TTL_SECONDS, now: new Date() },
      );
      return mediaSignResponseSchema.parse({
        signedUrl: signed.url,
        expiresAt: signed.expiresAt.toISOString(),
      });
    },
  );

  // DELETE /v1/media/:id — soft-delete the asset row AND remove
  // the underlying storage bytes. Idempotent on a missing id
  // (returns 204).
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
      const asset = await options.mediaAssetRepository.getById(id);
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
      const updated = await options.mediaAssetRepository.softDelete(id, now);
      if (updated === null) {
        // Race: someone else just deleted it. Return 204 — the
        // caller's intent (the asset is gone) holds.
        void reply.status(204).send();
        return;
      }
      await options.mediaStorage.remove(options.bucketId, asset.objectPath);
      void reply.status(204).send();
    },
  );
};

// Re-export the UserId type for downstream callers (the
// `apps/api/src/app.ts` composition root doesn't import from
// `@mizyun/core` directly here so the explicit re-export keeps
// the dependency tree tidy).
export type { UserId };
