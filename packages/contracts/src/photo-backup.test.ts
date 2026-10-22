import { describe, expect, it } from "vitest";
import {
  PHOTO_BACKUP_LIST_LIMIT,
  photoBackupListResponseSchema,
} from "./photo-backup";

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

describe("photoBackupListResponseSchema", () => {
  it("accepts owner meal and boulder backups", () => {
    expect(
      photoBackupListResponseSchema.parse({
        meals: [{ entryId: id(1), assetId: id(2) }],
        boulders: [{ ascentId: id(3), sessionId: id(4), assetId: id(5) }],
        truncated: false,
      }),
    ).toMatchObject({ truncated: false });
  });

  it("rejects extra fields, non-UUID ids and oversized pages", () => {
    for (const bad of [
      { meals: [{ entryId: id(1), assetId: id(2), objectPath: "x" }] },
      { meals: [{ entryId: "meal", assetId: id(2) }] },
      { boulders: [{ ascentId: id(3), assetId: id(5) }] },
      {
        meals: Array.from({ length: PHOTO_BACKUP_LIST_LIMIT + 1 }, () => ({
          entryId: id(1),
          assetId: id(2),
        })),
      },
    ])
      expect(
        photoBackupListResponseSchema.safeParse({
          meals: [],
          boulders: [],
          truncated: false,
          ...bad,
        }).success,
      ).toBe(false);
    expect(
      photoBackupListResponseSchema.safeParse({ meals: [], boulders: [] })
        .success,
    ).toBe(false);
  });
});
