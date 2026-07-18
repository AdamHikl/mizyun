/**
 * Media-asset wire schemas (MEDIA-001).
 *
 * Mirrors `public.media_assets` plus the storage coordinates.
 * The wire schema is bounded: mime types, byte size, dimensions,
 * and `purpose` are all constrained so a misconfigured client
 * cannot land a garbage row.
 */
import { z } from "zod";

export const mediaPurposeSchema = z.enum([
  "food",
  "progress",
  "workout",
  "profile",
]);

export const mediaAssetSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  bucketId: z.string().min(1),
  objectPath: z.string().min(1),
  purpose: mediaPurposeSchema,
  mimeType: z.string().min(1).max(127),
  byteSize: z
    .number()
    .int()
    .gte(0)
    .lte(15 * 1024 * 1024),
  width: z.number().int().gte(16).lte(8192).nullable(),
  height: z.number().int().gte(16).lte(8192).nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});

export type MediaAsset = z.infer<typeof mediaAssetSchema>;

export const mediaAssetResponseSchema = z.object({
  asset: mediaAssetSchema,
});

export type MediaAssetResponse = z.infer<typeof mediaAssetResponseSchema>;

export const mediaAssetListResponseSchema = z.object({
  assets: z.array(mediaAssetSchema),
});

export type MediaAssetListResponse = z.infer<
  typeof mediaAssetListResponseSchema
>;

/**
 * Body for `POST /v1/media/upload-url`. The client describes the
 * file it intends to upload; the route returns a signed URL the
 * client PUTs the bytes to. `byteSize` and `mimeType` are
 * required so the bucket's mime / size limits can be enforced
 * up front (the actual byte validation happens when storage
 * receives the body — but a client that lies about its size
 * is rejected here so the row metadata stays honest).
 */
export const mediaUploadUrlRequestSchema = z
  .object({
    purpose: mediaPurposeSchema,
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    byteSize: z
      .number()
      .int()
      .gte(0)
      .lte(15 * 1024 * 1024),
    width: z.number().int().gte(16).lte(8192).nullable().optional(),
    height: z.number().int().gte(16).lte(8192).nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type MediaUploadUrlRequest = z.infer<typeof mediaUploadUrlRequestSchema>;

export const mediaUploadUrlResponseSchema = z.object({
  assetId: z.string().uuid(),
  uploadUrl: z.string(),
  objectPath: z.string(),
  expiresAt: z.string().datetime(),
});

export type MediaUploadUrlResponse = z.infer<
  typeof mediaUploadUrlResponseSchema
>;

/**
 * Body for `POST /v1/media/sign`. Returns a short-lived signed
 * download URL for an existing asset. Ownership is enforced at
 * the route layer; the body carries only the asset id.
 */
export const mediaSignRequestSchema = z
  .object({
    assetId: z.string().uuid(),
  })
  .strict();

export type MediaSignRequest = z.infer<typeof mediaSignRequestSchema>;

export const mediaSignResponseSchema = z.object({
  signedUrl: z.string(),
  expiresAt: z.string().datetime(),
});

export type MediaSignResponse = z.infer<typeof mediaSignResponseSchema>;

/**
 * Query params for `GET /v1/media`. `purpose` is an optional
 * filter; `limit` caps the page size.
 */
export const mediaListQuerySchema = z
  .object({
    purpose: mediaPurposeSchema.optional(),
    limit: z.coerce.number().int().gte(1).lte(200).optional(),
  })
  .strict();

export type MediaListQuery = z.infer<typeof mediaListQuerySchema>;
