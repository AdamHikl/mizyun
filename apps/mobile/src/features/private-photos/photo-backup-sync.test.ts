import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: true,
  records: [] as Array<{
    kind: "meal" | "boulder";
    key: string;
    assetId: string | null;
    orphaned?: boolean;
  }>,
  local: new Set<string>(),
  backUpMeal: vi.fn(),
  ensureMeal: vi.fn(),
  backUpBoulder: vi.fn(),
  removeBoulder: vi.fn(),
  ensureBoulder: vi.fn(),
  download: vi.fn(),
  record: vi.fn(),
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: vi.fn() },
}));
vi.mock("@/features/log-meal/public-data", () => ({
  backUpLocalMealPhoto: mocks.backUpMeal,
  ensureMealPhotoOnDevice: mocks.ensureMeal,
}));
vi.mock("@/features/bouldering/public-data", () => ({
  backUpDeviceBoulderPhoto: mocks.backUpBoulder,
  removeBoulderPhotoBackup: mocks.removeBoulder,
  ensureBoulderPhotoOnDevice: mocks.ensureBoulder,
}));
vi.mock("./local-photo-library", () => ({
  listLocalPhotos: () => mocks.records,
  localPhotoRecord: (_owner: string, kind: string, key: string) =>
    mocks.local.has(`${kind}:${key}`) ? { kind, key, assetId: "x" } : null,
  downloadLocalPhoto: mocks.download,
  recordLocalPhotoBackup: mocks.record,
}));
vi.mock("./photo-backup-preference", () => ({
  loadPhotoBackupEnabled: async () => mocks.enabled,
}));

import { removePhotoBackups, syncPhotoBackups } from "./photo-backup-sync";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const M1 = "11111111-1111-4111-8111-111111111111";
const B1 = "22222222-2222-4222-8222-222222222222";
const ASSET = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";

const client = (routes: Record<string, unknown>) => ({
  request: vi.fn(async ({ method, path }: { method: string; path: string }) => {
    const value = routes[`${method} ${path}`];
    if (value === undefined) return { ok: false, error: { status: 500 } };
    return value instanceof Error
      ? { ok: false, error: { status: 403 } }
      : { ok: true, value };
  }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.records = [];
  mocks.local.clear();
  mocks.backUpMeal.mockResolvedValue(true);
  mocks.backUpBoulder.mockResolvedValue(true);
  mocks.removeBoulder.mockResolvedValue(true);
});

it("uploads nothing while backup is off", async () => {
  mocks.enabled = false;
  mocks.records = [{ kind: "boulder", key: B1, assetId: null }];
  const api = client({});
  expect(await syncPhotoBackups(OWNER, { client: api as any })).toEqual({
    uploaded: 0,
    pending: 0,
  });
  expect(mocks.backUpBoulder).not.toHaveBeenCalled();
  expect(api.request).not.toHaveBeenCalled();
});

it("backs up device-only boulders, and meals only with Pro", async () => {
  mocks.records = [
    { kind: "meal", key: M1, assetId: null },
    { kind: "boulder", key: B1, assetId: null },
    { kind: "boulder", key: ASSET, assetId: ASSET },
  ];
  const free = client({
    "GET /v1/food-entries/visuals/capability": { mealVisuals: false },
  });
  expect(await syncPhotoBackups(OWNER, { client: free as any })).toEqual({
    uploaded: 1,
    pending: 1,
  });
  expect(mocks.backUpMeal).not.toHaveBeenCalled();
  expect(mocks.backUpBoulder).toHaveBeenCalledTimes(1);
  expect(mocks.backUpBoulder).toHaveBeenCalledWith(
    expect.objectContaining({ userId: OWNER, ascentId: B1 }),
  );

  const pro = client({
    "GET /v1/food-entries/visuals/capability": { mealVisuals: true },
  });
  await syncPhotoBackups(OWNER, { client: pro as any });
  expect(mocks.backUpMeal).toHaveBeenCalledWith(
    OWNER,
    M1,
    expect.any(Function),
    pro,
  );
});

it("removes a backup only after the photo is on this phone", async () => {
  mocks.ensureMeal.mockResolvedValue(null); // e.g. Pro lapsed: cannot download
  mocks.ensureBoulder.mockResolvedValue(true);
  const api = client({
    "GET /v1/photo-backups": {
      meals: [{ entryId: M1, assetId: ASSET }],
      boulders: [{ ascentId: B1, sessionId: SESSION, assetId: ASSET }],
      truncated: false,
    },
  });
  const progress: number[] = [];
  const result = await removePhotoBackups(OWNER, {
    client: api as any,
    onProgress: (done) => progress.push(done),
  });
  expect(result).toEqual({ removed: 1, kept: 1, truncated: false });
  expect(api.request).not.toHaveBeenCalledWith(
    expect.objectContaining({ method: "DELETE" }),
  );
  expect(mocks.removeBoulder).toHaveBeenCalledWith(
    expect.objectContaining({ ascentId: B1 }),
  );
  expect(progress).toEqual([1, 2]);
  // The listed backup id is passed on, so a stale device copy never counts.
  expect(mocks.ensureMeal).toHaveBeenCalledWith(
    OWNER,
    M1,
    expect.any(Function),
    api,
    ASSET,
  );
  expect(mocks.ensureBoulder).toHaveBeenCalledWith(
    expect.objectContaining({ userId: OWNER, ascentId: B1, assetId: ASSET }),
  );
});

it("deletes a meal backup once its device copy exists and clears its record", async () => {
  mocks.ensureMeal.mockResolvedValue("file:///docs/meal.jpg");
  const api = client({
    "GET /v1/photo-backups": {
      meals: [{ entryId: M1, assetId: ASSET }],
      boulders: [],
      truncated: true,
    },
    [`DELETE /v1/food-entries/${M1}/photo`]: null,
  });
  expect(await removePhotoBackups(OWNER, { client: api as any })).toEqual({
    removed: 1,
    kept: 0,
    truncated: true,
  });
  expect(mocks.record).toHaveBeenCalledWith(OWNER, "meal", M1, null);
});

it("does not touch boulder backups it cannot download first", async () => {
  const api = client({
    "GET /v1/photo-backups": {
      meals: [],
      boulders: [{ ascentId: B1, sessionId: SESSION, assetId: ASSET }],
    },
  });
  mocks.ensureBoulder.mockResolvedValue(false);
  expect(await removePhotoBackups(OWNER, { client: api as any })).toEqual({
    removed: 0,
    kept: 1,
    truncated: false,
  });
  expect(mocks.removeBoulder).not.toHaveBeenCalled();
});

it("skips orphaned photos and tries earlier failures last", async () => {
  const B2 = "55555555-5555-4555-8555-555555555555";
  mocks.records = [
    { kind: "boulder", key: ASSET, assetId: null, orphaned: true },
    { kind: "boulder", key: B1, assetId: null },
    { kind: "boulder", key: B2, assetId: null },
  ];
  mocks.backUpBoulder.mockResolvedValueOnce(false).mockResolvedValue(true);
  const api = client({});
  await syncPhotoBackups(OWNER, { client: api as any });
  expect(
    mocks.backUpBoulder.mock.calls.map(([input]) => input.ascentId),
  ).toEqual([B1, B2]);
  mocks.backUpBoulder.mockClear();
  await syncPhotoBackups(OWNER, { client: api as any });
  // B1 failed last time, so B2 goes first; the orphan is never uploaded.
  expect(
    mocks.backUpBoulder.mock.calls.map(([input]) => input.ascentId),
  ).toEqual([B2, B1]);
});
