import { describe, expect, it } from "vitest";
import { accountExportSchema } from "./account.js";
const userId = "00000000-0000-4000-8000-000000000001";
const record = {
  userId,
  pathKey: "a".repeat(64),
  createdAt: "2026-10-09T10:00:00.000Z",
};
describe("owned technical meal image export", () => {
  it("accepts bounded path hashes and normalized timestamps", () => {
    expect(
      accountExportSchema.shape.mealImagePaths.safeParse([record]).success,
    ).toBe(true);
  });
  it("rejects invalid ownership/hash/time and raw filenames in the technical ledger", () => {
    for (const value of [
      { ...record, userId: "peer" },
      { ...record, pathKey: "x".repeat(64) },
      { ...record, pathKey: "a".repeat(65) },
      { ...record, createdAt: "2026-10-09T10:00:00+00:00" },
      { ...record, objectPath: `${userId}/private-health-name.jpg` },
    ]) {
      expect(
        accountExportSchema.shape.mealImagePaths.safeParse([value]).success,
      ).toBe(false);
    }
  });
});
