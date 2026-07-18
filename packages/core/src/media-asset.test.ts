import { describe, expect, it } from "vitest";

import type { UserId } from "./index.js";
import {
  buildObjectPath,
  MEDIA_MAX_BYTE_SIZE,
  validateMediaAssetCreate,
  type StoredMediaAsset,
} from "./media-asset.js";

const userId = "00000000-0000-4000-8000-000000000001" as UserId;

const baseStored = (
  overrides: Partial<StoredMediaAsset> = {},
): StoredMediaAsset => ({
  id: "00000000-0000-4000-8000-00000000a001",
  userId,
  bucketId: "private-media",
  objectPath: `${userId}/00000000-0000-4000-8000-00000000a001.jpg`,
  purpose: "progress",
  mimeType: "image/jpeg",
  byteSize: 1024,
  width: 1024,
  height: 1024,
  metadata: {},
  createdAt: new Date("2026-07-10T08:00:00Z"),
  deletedAt: null,
  ...overrides,
});

describe("validateMediaAssetCreate", () => {
  it("accepts a basic image upload", () => {
    expect(
      validateMediaAssetCreate({
        purpose: "progress",
        mimeType: "image/jpeg",
        byteSize: 1024,
        width: 1024,
        height: 1024,
      }),
    ).toBeNull();
  });

  it("accepts an asset with no dimensions (server fills later)", () => {
    expect(
      validateMediaAssetCreate({
        purpose: "food",
        mimeType: "image/png",
        byteSize: 1024,
        width: null,
        height: null,
      }),
    ).toBeNull();
  });

  it("rejects an unsupported mime type", () => {
    expect(
      validateMediaAssetCreate({
        purpose: "progress",
        mimeType: "image/gif",
        byteSize: 1024,
        width: 1024,
        height: 1024,
      }),
    ).toEqual({ kind: "unsupported_mime_type" });
  });

  it("rejects an unsupported purpose", () => {
    expect(
      validateMediaAssetCreate({
        purpose: "garbage",
        mimeType: "image/jpeg",
        byteSize: 1024,
        width: 1024,
        height: 1024,
      } as unknown as Parameters<typeof validateMediaAssetCreate>[0]),
    ).toEqual({ kind: "unsupported_purpose" });
  });

  it("rejects a byte size above the bucket cap", () => {
    expect(
      validateMediaAssetCreate({
        purpose: "progress",
        mimeType: "image/jpeg",
        byteSize: MEDIA_MAX_BYTE_SIZE + 1,
        width: 1024,
        height: 1024,
      }),
    ).toEqual({
      kind: "byte_size_out_of_range",
      max: MEDIA_MAX_BYTE_SIZE,
    });
  });

  it("rejects a width below the minimum", () => {
    expect(
      validateMediaAssetCreate({
        purpose: "progress",
        mimeType: "image/jpeg",
        byteSize: 1024,
        width: 8,
        height: 1024,
      }),
    ).toEqual({
      kind: "dimension_out_of_range",
      min: 16,
      max: 8192,
    });
  });

  it("rejects a non-object metadata value", () => {
    expect(
      validateMediaAssetCreate({
        purpose: "progress",
        mimeType: "image/jpeg",
        byteSize: 1024,
        width: 1024,
        height: 1024,
        metadata: null as unknown as Record<string, unknown>,
      }),
    ).toEqual({ kind: "metadata_must_be_object" });
  });
});

describe("buildObjectPath", () => {
  it("places the asset under the user's folder with a uuid id and the right extension", () => {
    const path = buildObjectPath(userId, "abc-123", "image/jpeg");
    expect(path).toBe(`${userId}/abc-123.jpg`);
  });

  it("uses .png for image/png", () => {
    expect(buildObjectPath(userId, "abc", "image/png")).toBe(
      `${userId}/abc.png`,
    );
  });

  it("uses .webp for image/webp", () => {
    expect(buildObjectPath(userId, "abc", "image/webp")).toBe(
      `${userId}/abc.webp`,
    );
  });

  it("falls back to .bin for unknown mime types", () => {
    expect(buildObjectPath(userId, "abc", "image/gif")).toBe(
      `${userId}/abc.bin`,
    );
  });

  it("never accepts a client-supplied folder prefix", () => {
    const path = buildObjectPath(userId, "abc", "image/jpeg");
    expect(path.startsWith(`${userId}/`)).toBe(true);
    // The path has exactly one '/' after the userId segment.
    expect(path.split("/")).toHaveLength(2);
  });
});

describe("StoredMediaAsset shape", () => {
  it("carries deletedAt as null by default", () => {
    const stored = baseStored();
    expect(stored.deletedAt).toBeNull();
  });

  it("deletedAt can be set to a Date", () => {
    const stored = baseStored({ deletedAt: new Date("2026-07-15T00:00:00Z") });
    expect(stored.deletedAt).toBeInstanceOf(Date);
  });
});
