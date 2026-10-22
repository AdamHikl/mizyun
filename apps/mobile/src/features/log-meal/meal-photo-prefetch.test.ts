import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  owner: "owner-a" as string | null,
  token: "token-a",
  enabled: true,
  appState: "active",
  read: vi.fn(),
  prefetch: vi.fn(),
  keep: vi.fn(),
  records: {} as Record<string, { assetId: string | null }>,
  effects: [] as (() => void | (() => void))[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => void | (() => void)) => {
    mocks.effects.push(effect);
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return mocks.appState;
    },
  },
}));
vi.mock("expo-image", () => ({ Image: { prefetch: mocks.prefetch } }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: mocks.owner
      ? { user: { id: mocks.owner }, accessToken: mocks.token }
      : null,
  }),
}));
vi.mock("./meal-photo-download", () => ({
  keepMealBackupOnDevice: mocks.keep,
}));
vi.mock("@/features/private-photos/local-photo-library", () => ({
  localPhotoRecord: (_owner: string, _kind: string, key: string) =>
    mocks.records[key] ?? null,
}));
vi.mock("./meal-photo-retention", () => ({
  fetchMealPhoto: mocks.read,
  mealPhotoRetentionEnabled: () => mocks.enabled,
}));
import { usePrefetchMealPhotos } from "./meal-photo-prefetch";
import {
  confirmMealVisuals,
  forgetMealVisualMemory,
  mealPhotoScope,
  rememberPhoto,
  rememberedPhoto,
  setMealPhotoPrincipal,
} from "./meal-photo-memory";

const photo = (assetId: string) => ({
  assetId,
  width: 640,
  height: 480,
  signedUrl: `https://private.example/${assetId}`,
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
});
const entries = [
  { id: "meal-a", photoAssetId: "asset-a" },
  { id: "meal-b", photoAssetId: null },
  { id: "meal-c", photoAssetId: "asset-c" },
] as any;
async function run(list = entries) {
  mocks.effects = [];
  usePrefetchMealPhotos(list);
  const cleanups = mocks.effects.map((effect) => effect());
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((done) => setTimeout(done, 0));
  return cleanups;
}
beforeEach(() => {
  vi.clearAllMocks();
  forgetMealVisualMemory();
  setMealPhotoPrincipal(null, null);
  mocks.owner = "owner-a";
  mocks.token = "token-a";
  mocks.enabled = true;
  mocks.appState = "active";
  mocks.read.mockImplementation(async (entryId: string) => ({
    ok: true,
    value: { photo: photo(entryId.replace("meal", "asset")) },
  }));
  mocks.prefetch.mockResolvedValue(true);
  mocks.records = {};
});

it("signs and saves only backed-up meals to the device and remembers them for rows", async () => {
  await run();
  expect(mocks.read.mock.calls.map(([id]) => id)).toEqual(["meal-a", "meal-c"]);
  expect(
    rememberedPhoto(mealPhotoScope("owner-a", "token-a", "meal-a"), "asset-a")
      ?.signedUrl,
  ).toBe("https://private.example/asset-a");
  expect(mocks.keep).toHaveBeenCalledWith(
    "owner-a",
    "meal-a",
    expect.objectContaining({
      assetId: "asset-a",
      signedUrl: "https://private.example/asset-a",
    }),
  );
  expect(mocks.keep).toHaveBeenCalledTimes(2);
  expect(mocks.prefetch).not.toHaveBeenCalled();
  await run();
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it("skips entries whose device copy already matches the backup asset", async () => {
  mocks.records = { "meal-a": { assetId: "asset-a" } };
  await run();
  expect(mocks.read.mock.calls.map(([id]) => id)).toEqual(["meal-c"]);
  expect(mocks.keep).toHaveBeenCalledTimes(1);
});

it("re-reads an entry whose device copy is from a different asset or device-only", async () => {
  mocks.records = {
    "meal-a": { assetId: "asset-old" },
    "meal-c": { assetId: null },
  };
  await run();
  expect(mocks.read.mock.calls.map(([id]) => id)).toEqual(["meal-a", "meal-c"]);
});

it("skips prefetching after a denied capability (for any token), without a session, retention or foreground", async () => {
  confirmMealVisuals(JSON.stringify(["owner-a", "token-a"]), "owner-a", false);
  await run();
  mocks.token = "token-refreshed";
  await run();
  mocks.token = "token-a";
  confirmMealVisuals(JSON.stringify(["owner-a", "token-a"]), "owner-a", true);
  mocks.appState = "background";
  await run();
  mocks.appState = "active";
  mocks.owner = null;
  await run();
  mocks.owner = "owner-a";
  mocks.token = "token-b";
  mocks.enabled = false;
  await run();
  expect(mocks.read).not.toHaveBeenCalled();
});

it("does not remember a read that settles after memory was forgotten", async () => {
  let resolve!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await run([entries[0]]);
  forgetMealVisualMemory();
  resolve({ ok: true, value: { photo: photo("asset-a") } });
  await run([]);
  expect(
    rememberedPhoto(mealPhotoScope("owner-a", "token-a", "meal-a")),
  ).toBeNull();
  expect(mocks.keep).not.toHaveBeenCalled();
});

it("does not remember or download a rejected read", async () => {
  mocks.read.mockResolvedValue({ ok: false, error: { kind: "http_error" } });
  await run([entries[0]]);
  expect(
    rememberedPhoto(mealPhotoScope("owner-a", "token-a", "meal-a")),
  ).toBeNull();
  expect(mocks.keep).not.toHaveBeenCalled();
});

it("a late read for a previous token cannot evict the refreshed token's photos", async () => {
  let resolve!: (value: unknown) => void;
  setMealPhotoPrincipal("owner-a", "token-a");
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await run([entries[0]]);
  setMealPhotoPrincipal("owner-a", "token-b");
  const fresh = mealPhotoScope("owner-a", "token-b", "meal-a");
  rememberPhoto(fresh, photo("asset-a"));
  resolve({ ok: true, value: { photo: photo("asset-a") } });
  await run([]);
  expect(rememberedPhoto(fresh)).not.toBeNull();
  expect(
    rememberedPhoto(mealPhotoScope("owner-a", "token-a", "meal-a")),
  ).toBeNull();
});
