import type { UserId } from "./index";

/**
 * Media-asset domain types and validation rules (MEDIA-001).
 *
 * Pure: no database, no transport, no SDK. The wire schema lives
 * in `@mizyun/contracts`; this module owns the closed `purpose`
 * enum, the bounded numeric fields, and the repository port that
 * adapters implement.
 *
 * The shape mirrors `public.media_assets` plus the
 * `private-media` storage bucket. The asset row records the
 * metadata (purpose, mime, byte size, dimensions); the actual
 * bytes live in object storage at the `objectPath`. Signed URLs
 * are short-lived and never reach the wire in raw form beyond a
 * one-time `uploadUrl` response; download signing is the
 * server-side responsibility.
 */

export type MediaPurpose = "food" | "progress" | "workout" | "profile";

/** Closed set mirroring the SQL `purpose` check constraint. */
export const MEDIA_PURPOSES: ReadonlyArray<MediaPurpose> = [
  "food",
  "progress",
  "workout",
  "profile",
];

/** Plausible mime-type cap (15 MiB). Matches the SQL bucket limit. */
export const MEDIA_MAX_BYTE_SIZE = 15 * 1024 * 1024;

/**
 * Bounded image dimensions. We only accept sane photos;
 * pathological values (0 width, million-pixel heights) are
 * rejected so the storage layer doesn't carry garbage.
 */
export const MEDIA_MIN_DIMENSION = 16;
export const MEDIA_MAX_DIMENSION = 8192;

/**
 * Editable domain shape. The wire schema in `@mizyun/contracts`
 * adds `id`, `userId`, `bucketId`, `objectPath`, `createdAt`,
 * and (eventually) `deletedAt`. This type is the editable
 * subset the route accepts and returns.
 */
export interface MediaAssetCore {
  readonly purpose: MediaPurpose;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Full stored media asset, including the user id, the storage
 * coordinates (`bucketId`, `objectPath`), and the audit
 * `createdAt`. `deletedAt` is nullable — when set, the asset
 * has been soft-deleted by the user but the row stays for
 * forensic purposes. The storage adapter removes the bytes
 * immediately on `delete`.
 */
export interface StoredMediaAsset extends MediaAssetCore {
  readonly id: string;
  readonly userId: UserId;
  readonly bucketId: string;
  readonly objectPath: string;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

/**
 * Why-not-valid reasons for a media-asset create. The discriminated
 * union keeps the rejection reason machine-checkable at the
 * route layer.
 */
export type MediaAssetValidationError =
  | { readonly kind: "unsupported_mime_type" }
  | { readonly kind: "byte_size_out_of_range"; readonly max: number }
  | {
      readonly kind: "dimension_out_of_range";
      readonly min: number;
      readonly max: number;
    }
  | { readonly kind: "unsupported_purpose" }
  | { readonly kind: "metadata_must_be_object" };

/** Closed set of mime types the bucket accepts. Mirrors the SQL bucket. */
export const MEDIA_ALLOWED_MIME_TYPES: ReadonlyArray<string> = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

/**
 * Validate a create body. The route owns the `id`, `bucketId`,
 * `objectPath`, and audit timestamps; the validator focuses on
 * per-field bounds.
 */
export const validateMediaAssetCreate = (create: {
  readonly purpose: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): MediaAssetValidationError | null => {
  if (!(MEDIA_PURPOSES as ReadonlyArray<string>).includes(create.purpose)) {
    return { kind: "unsupported_purpose" };
  }
  if (!MEDIA_ALLOWED_MIME_TYPES.includes(create.mimeType)) {
    return { kind: "unsupported_mime_type" };
  }
  if (
    typeof create.byteSize !== "number" ||
    !Number.isFinite(create.byteSize) ||
    create.byteSize < 0 ||
    create.byteSize > MEDIA_MAX_BYTE_SIZE
  ) {
    return { kind: "byte_size_out_of_range", max: MEDIA_MAX_BYTE_SIZE };
  }
  for (const dim of [create.width, create.height] as const) {
    if (dim === null) continue;
    if (
      typeof dim !== "number" ||
      !Number.isInteger(dim) ||
      dim < MEDIA_MIN_DIMENSION ||
      dim > MEDIA_MAX_DIMENSION
    ) {
      return {
        kind: "dimension_out_of_range",
        min: MEDIA_MIN_DIMENSION,
        max: MEDIA_MAX_DIMENSION,
      };
    }
  }
  if (
    create.metadata !== undefined &&
    (create.metadata === null ||
      typeof create.metadata !== "object" ||
      Array.isArray(create.metadata))
  ) {
    return { kind: "metadata_must_be_object" };
  }
  return null;
};

/**
 * Synthesize a private-media object path for a user. The path
 * is `<userId>/<uuid>.<ext>` so the storage layer's RLS policy
 * (`storage.foldername(name)[1] = auth.uid()::text`) scopes
 * every upload to the user's own folder.
 *
 * The extension is a low-cardinality guess from the mime type so
 * storage tooling that distinguishes JPEG/PNG/WebP by extension
 * continues to work. The route never trusts a client-supplied
 * filename.
 */
export const buildObjectPath = (
  userId: UserId,
  id: string,
  mimeType: string,
): string => {
  let ext = "bin";
  if (mimeType === "image/jpeg") ext = "jpg";
  else if (mimeType === "image/png") ext = "png";
  else if (mimeType === "image/webp") ext = "webp";
  return `${userId}/${id}.${ext}`;
};

/**
 * Repository port. The Supabase adapter implements this against
 * the `public.media_assets` table plus the storage SDK; tests
 * implement it with an in-memory map.
 */
export interface MediaAssetRepository {
  /**
   * Insert a new asset row. The repository assigns `id` and
   * `createdAt` and returns the stored shape. The storage adapter
   * does NOT touch the object store here — that's the client's
   * job (after the route returns the signed upload URL).
   */
  create(userId: UserId, asset: StoredMediaAsset): Promise<StoredMediaAsset>;
  /**
   * List the user's non-deleted assets, newest-first. `purpose`
   * is an optional filter. `limit` caps the page size.
   */
  list(
    userId: UserId,
    options: {
      readonly purpose: MediaPurpose | null;
      readonly limit: number;
    },
  ): Promise<ReadonlyArray<StoredMediaAsset>>;
  /**
   * Return the stored asset by id, or `null` when no asset
   * exists with that id. Soft-deleted assets still return from
   * `getById` so a follow-up signed-URL request can tell
   * "deleted" from "missing".
   */
  getById(id: string): Promise<StoredMediaAsset | null>;
  /**
   * Mark the asset deleted (sets `deletedAt = now`) AND returns
   * the row so the route can ask the storage layer to remove
   * the underlying bytes. Returns `null` when the id does not
   * exist.
   */
  softDelete(id: string, now: Date): Promise<StoredMediaAsset | null>;
}
