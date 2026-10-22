import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("@/features/private-photos/local-photo-library", () => ({
  downloadLocalPhoto: mocks.download,
}));
vi.mock("./meal-photo-retention", () => ({
  MAX_RETAINED_MEAL_PHOTO_BYTES: 262_144,
}));
import { keepMealBackupOnDevice } from "./meal-photo-download";

const photo = (assetId: string) =>
  ({
    assetId,
    width: 640,
    height: 480,
    signedUrl: `https://private.example/${assetId}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }) as any;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.download.mockResolvedValue("file:///documents/meal.jpg");
});

it("does nothing without a photo", () => {
  keepMealBackupOnDevice("owner-a", "meal-a", null);
  expect(mocks.download).not.toHaveBeenCalled();
});

it("saves the signed photo into the device library with its asset id and size cap", () => {
  keepMealBackupOnDevice("owner-a", "meal-a", photo("asset-1"));
  expect(mocks.download).toHaveBeenCalledWith(
    "owner-a",
    "meal",
    "meal-a",
    "https://private.example/asset-1",
    { assetId: "asset-1", maxBytes: 262_144 },
  );
});

it("starts one download per photo while one is in flight, then allows a retry after failure", async () => {
  let reject!: (error: Error) => void;
  mocks.download.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  keepMealBackupOnDevice("owner-a", "meal-a", photo("asset-2"));
  keepMealBackupOnDevice("owner-a", "meal-a", photo("asset-2"));
  expect(mocks.download).toHaveBeenCalledTimes(1);
  reject(new Error("offline"));
  await new Promise((done) => setTimeout(done, 0));
  keepMealBackupOnDevice("owner-a", "meal-a", photo("asset-2"));
  expect(mocks.download).toHaveBeenCalledTimes(2);
});

it("treats a different account or replaced asset as a separate download", () => {
  keepMealBackupOnDevice("owner-a", "meal-b", photo("asset-3"));
  keepMealBackupOnDevice("owner-b", "meal-b", photo("asset-3"));
  keepMealBackupOnDevice("owner-a", "meal-b", photo("asset-4"));
  expect(mocks.download).toHaveBeenCalledTimes(3);
});
