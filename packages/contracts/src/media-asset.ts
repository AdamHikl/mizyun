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
  "feedback",
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

/**
 * A timeline entry: an asset plus its short-lived signed
 * download URL. The route issues a fresh URL per entry so the
 * UI can render a thumbnail strip without a second round-trip.
 *
 * The URL is valid for `URL_TTL_SECONDS`; the client re-fetches
 * the timeline when it expires.
 */
const urlTtlSeconds = z.number().int().gte(0).lte(3600);

export const mediaTimelineEntrySchema = z.object({
  asset: mediaAssetSchema,
  signedUrl: z.string(),
  signedUrlExpiresAt: z.string().datetime(),
});

export type MediaTimelineEntry = z.infer<typeof mediaTimelineEntrySchema>;

/**
 * A timeline bucket groups the assets for one calendar day.
 * The bucket key is the UTC calendar day; the UI uses the entry
 * count as a "you took 4 photos on this day" label.
 */
export const mediaTimelineBucketSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  entryCount: z.number().int().gte(0).lte(200),
  entries: z.array(mediaTimelineEntrySchema),
});

export type MediaTimelineBucket = z.infer<typeof mediaTimelineBucketSchema>;

export const mediaTimelineResponseSchema = z.object({
  buckets: z.array(mediaTimelineBucketSchema),
  /**
   * Bounded URL TTL echoed in the response so the client can
   * use the field for its own cache-control. Keeps the wire
   * stable when the route's default TTL changes.
   */
  signedUrlTtlSeconds: urlTtlSeconds,
});

export type MediaTimelineResponse = z.infer<typeof mediaTimelineResponseSchema>;

/**
 * Query string for `GET /v1/media/timeline`. The default
 * `purpose` is `progress` because that's BODY-04's narrowly-
 * scoped use case; callers filter to a different purpose
 * explicitly when needed. `from`/`to` are inclusive
 * `YYYY-MM-DD` (UTC) bounds on `createdAt`.
 */
export const mediaTimelineQuerySchema = z
  .object({
    purpose: mediaPurposeSchema.optional(),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
      .optional(),
    limit: z.coerce.number().int().gte(1).lte(200).optional(),
  })
  .strict()
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      query.from <= query.to,
    { message: "from must be on or before to", path: ["from"] },
  );

export type MediaTimelineQuery = z.infer<typeof mediaTimelineQuerySchema>;

/**
 * Body for `POST /v1/media/compare`. Both asset ids must
 * belong to the user; the route returns 404 if either is
 * missing or cross-user. The response carries a per-side
 * signed URL plus the relative-time delta ("b is N days after
 * a") the UI renders in the photo-compare view.
 */
export const mediaCompareRequestSchema = z
  .object({
    assetIdA: z.string().uuid(),
    assetIdB: z.string().uuid(),
    urlTtlSeconds: urlTtlSeconds.optional(),
  })
  .strict()
  .refine((body) => body.assetIdA !== body.assetIdB, {
    message: "assetIdA and assetIdB must differ",
    path: ["assetIdB"],
  });

export type MediaCompareRequest = z.infer<typeof mediaCompareRequestSchema>;

export const mediaCompareSideSchema = z.object({
  asset: mediaAssetSchema,
  signedUrl: z.string(),
  signedUrlExpiresAt: z.string().datetime(),
});

export type MediaCompareSide = z.infer<typeof mediaCompareSideSchema>;

export const mediaCompareResponseSchema = z.object({
  sideA: mediaCompareSideSchema,
  sideB: mediaCompareSideSchema,
  daysBetween: z.number(),
  /** "before" when `a` is older, "after" when `b` is older. */
  direction: z.enum(["a_before_b", "a_after_b"]),
});

export type MediaCompareResponse = z.infer<typeof mediaCompareResponseSchema>;
