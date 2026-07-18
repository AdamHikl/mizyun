import { describe, expect, it } from "vitest";

import type { UserId } from "./index.js";
import {
  buildMediaTimeline,
  buildObjectPath,
  compareMediaAssets,
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

describe("buildMediaTimeline", () => {
  it("returns an empty list when no assets are in range", () => {
    expect(
      buildMediaTimeline([], { from: "2026-07-10", to: "2026-07-12" }),
    ).toEqual([]);
  });

  it("groups assets by UTC calendar day", () => {
    const assets = [
      baseStored({
        id: "00000000-0000-4000-8000-00000000a001",
        createdAt: new Date("2026-07-10T08:00:00Z"),
      }),
      baseStored({
        id: "00000000-0000-4000-8000-00000000a002",
        createdAt: new Date("2026-07-12T18:00:00Z"),
      }),
      baseStored({
        id: "00000000-0000-4000-8000-00000000a003",
        createdAt: new Date("2026-07-10T20:00:00Z"),
      }),
    ];
    const buckets = buildMediaTimeline(assets, {
      from: "2026-07-10",
      to: "2026-07-12",
    });
    expect(buckets.map((b) => b.date)).toEqual(["2026-07-10", "2026-07-12"]);
    expect(buckets[0]?.entryCount).toBe(2);
    // Within a day, newest first.
    expect(buckets[0]?.entries[0]?.id).toBe(
      "00000000-0000-4000-8000-00000000a003",
    );
    expect(buckets[0]?.entries[1]?.id).toBe(
      "00000000-0000-4000-8000-00000000a001",
    );
  });

  it("drops soft-deleted assets", () => {
    const assets = [
      baseStored({
        id: "00000000-0000-4000-8000-00000000a001",
        createdAt: new Date("2026-07-10T08:00:00Z"),
        deletedAt: new Date("2026-07-10T09:00:00Z"),
      }),
      baseStored({
        id: "00000000-0000-4000-8000-00000000a002",
        createdAt: new Date("2026-07-10T20:00:00Z"),
      }),
    ];
    const buckets = buildMediaTimeline(assets, {
      from: "2026-07-10",
      to: "2026-07-10",
    });
    expect(buckets[0]?.entryCount).toBe(1);
    expect(buckets[0]?.entries[0]?.id).toBe(
      "00000000-0000-4000-8000-00000000a002",
    );
  });

  it("ignores assets outside [from, to]", () => {
    const assets = [
      baseStored({
        id: "00000000-0000-4000-8000-00000000a001",
        createdAt: new Date("2026-07-09T08:00:00Z"),
      }),
      baseStored({
        id: "00000000-0000-4000-8000-00000000a002",
        createdAt: new Date("2026-07-15T08:00:00Z"),
      }),
    ];
    const buckets = buildMediaTimeline(assets, {
      from: "2026-07-10",
      to: "2026-07-12",
    });
    expect(buckets).toEqual([]);
  });

  it("returns oldest days first", () => {
    const assets = [
      baseStored({
        id: "00000000-0000-4000-8000-00000000a003",
        createdAt: new Date("2026-07-12T08:00:00Z"),
      }),
      baseStored({
        id: "00000000-0000-4000-8000-00000000a001",
        createdAt: new Date("2026-07-10T08:00:00Z"),
      }),
      baseStored({
        id: "00000000-0000-4000-8000-00000000a002",
        createdAt: new Date("2026-07-11T08:00:00Z"),
      }),
    ];
    const buckets = buildMediaTimeline(assets, {
      from: "2026-07-10",
      to: "2026-07-12",
    });
    expect(buckets.map((b) => b.date)).toEqual([
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ]);
  });
});

describe("compareMediaAssets", () => {
  it("returns zero days when the assets are on the same UTC day", () => {
    const a = baseStored({ createdAt: new Date("2026-07-10T08:00:00Z") });
    const b = baseStored({ createdAt: new Date("2026-07-10T22:30:00Z") });
    const result = compareMediaAssets(a, b);
    expect(result.daysBetween).toBe(0);
  });

  it("returns the absolute calendar-day distance", () => {
    const a = baseStored({ createdAt: new Date("2026-07-10T08:00:00Z") });
    const b = baseStored({ createdAt: new Date("2026-07-17T08:00:00Z") });
    expect(compareMediaAssets(a, b).daysBetween).toBe(7);
  });

  it("reports direction a_before_b when a is older", () => {
    const a = baseStored({ createdAt: new Date("2026-07-10T08:00:00Z") });
    const b = baseStored({ createdAt: new Date("2026-07-17T08:00:00Z") });
    expect(compareMediaAssets(a, b).direction).toBe("a_before_b");
  });

  it("reports direction a_after_b when a is newer", () => {
    const a = baseStored({ createdAt: new Date("2026-07-17T08:00:00Z") });
    const b = baseStored({ createdAt: new Date("2026-07-10T08:00:00Z") });
    expect(compareMediaAssets(a, b).direction).toBe("a_after_b");
  });

  it("rounds sub-day differences to the same calendar day (1)", () => {
    // Photos one hour apart across UTC midnight — they fall on
    // different UTC calendar days, so the rounded day count is 1.
    const a = baseStored({ createdAt: new Date("2026-07-10T23:30:00Z") });
    const b = baseStored({ createdAt: new Date("2026-07-11T00:30:00Z") });
    expect(compareMediaAssets(a, b).daysBetween).toBe(1);
  });

  it("rounds photos on the same calendar day to zero", () => {
    // Photos four hours apart, same UTC day → 0 days.
    const a = baseStored({ createdAt: new Date("2026-07-10T08:00:00Z") });
    const b = baseStored({ createdAt: new Date("2026-07-10T12:00:00Z") });
    expect(compareMediaAssets(a, b).daysBetween).toBe(0);
  });
});
