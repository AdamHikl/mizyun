import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  variant: "dev",
  enabled: true,
  files: new Map<string, number>(),
  values: new Map<string, unknown>(),
  request: vi.fn(),
  resize: vi.fn(),
  save: vi.fn(),
  sequence: 0,
  indexFailure: false,
  clearFailure: false,
  delayedWrite: null as null | (() => Promise<void>),
}));
vi.mock("@/composition/app-variant", () => ({
  getAppVariant: () => mocks.variant,
}));
vi.mock("expo-constants", () => ({
  default: {
    get expoConfig() {
      return { extra: { enableMealPhotos: mocks.enabled } };
    },
  },
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: mocks.request },
}));
vi.mock("./meal-form", () => ({
  createOperationId: () =>
    `11111111-1111-4111-8111-${String(++mocks.sequence).padStart(12, "0")}`,
  isValidOperationId: (value: unknown) =>
    typeof value === "string" && /^[0-9a-f-]{36}$/.test(value),
}));
vi.mock("expo-file-system", () => {
  const uri = (parts: any[]) =>
    parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
  class File {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = uri(parts);
    }
    get exists() {
      return mocks.files.has(this.uri);
    }
    get size() {
      return mocks.files.get(this.uri) ?? 0;
    }
    copy(destination: File) {
      if (!this.exists) throw new Error("Missing");
      mocks.files.set(destination.uri, this.size);
    }
    delete() {
      mocks.files.delete(this.uri);
    }
    async base64() {
      return "safe-jpeg-pixels";
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = uri(parts);
    }
    create() {}
    get exists() {
      return [...mocks.files.keys()].some((key) =>
        key.startsWith(this.uri + "/"),
      );
    }
    delete() {
      for (const key of mocks.files.keys())
        if (key.startsWith(this.uri + "/")) mocks.files.delete(key);
    }
  }
  return { File, Directory, Paths: { document: { uri: "file:///documents" } } };
});
vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: {
    manipulate: (source: unknown) => ({
      resize: mocks.resize,
      renderAsync: async () =>
        typeof source === "string"
          ? { width: 1000, height: 2000 }
          : { saveAsync: mocks.save },
    }),
  },
}));
vi.mock("@/features/logging-draft-storage", () => ({
  loadLoggingDraft: async (
    owner: string,
    kind: string,
    validate: (value: unknown) => boolean,
  ) => {
    const value = mocks.values.get(owner + ":" + kind);
    return validate(value) ? value : null;
  },
  saveLoggingDraft: async (owner: string, kind: string, value: unknown) => {
    if (mocks.delayedWrite && kind !== "meal-photo-index")
      await mocks.delayedWrite();
    if (kind === "meal-photo-index" && mocks.indexFailure) return false;
    mocks.values.set(owner + ":" + kind, value);
    return true;
  },
  clearLoggingDraft: async (owner: string, kind: string) => {
    if (mocks.clearFailure) return false;
    mocks.values.delete(owner + ":" + kind);
    return true;
  },
}));
import {
  clearAllMealPhotoRetries,
  discardOwnedMealPhoto,
  loadMealPhotoRetry,
  mealPhotoRetentionEnabled,
  persistMealPhotoRetry,
  prepareRetainedMealPhoto,
  removeMealPhotoRetry,
  uploadMealPhotoRetry,
} from "./meal-photo-retention";
const descriptor = (owner = "owner-a") => ({
  uri: `file:///documents/meal-photo-drafts/${owner}/source.jpg`,
  width: 0,
  height: 0,
  clientOperationId: "11111111-1111-4111-8111-111111111111",
});
beforeEach(() => {
  mocks.values.clear();
  mocks.files.clear();
  mocks.sequence = 0;
  mocks.indexFailure = false;
  mocks.clearFailure = false;
  mocks.delayedWrite = null;
  mocks.variant = "dev";
  mocks.enabled = true;
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ ok: false });
  mocks.save.mockImplementation(async () => {
    const uri = `file:///cache/thumbnail-${++mocks.sequence}.jpg`;
    mocks.files.set(uri, 50_000);
    return { uri, width: 320, height: 640 };
  });
});
it("caps portrait photos by decoded dimensions and independently reencodes JPEG", async () => {
  const prepared = await prepareRetainedMealPhoto("owner-a", {
    uri: "library-original",
  });
  expect(mocks.resize).toHaveBeenCalledWith({ width: null, height: 640 });
  expect(mocks.save).toHaveBeenCalledWith({ format: "jpeg", compress: 0.7 });
  expect(prepared).toMatchObject({ width: 320, height: 640 });
  expect(prepared.uri).toContain(
    "file:///documents/meal-photo-drafts/owner-a/",
  );
});
it("rejects oversized output after bounded compression attempts", async () => {
  mocks.save.mockImplementation(async () => {
    mocks.files.set("file:///cache/large.jpg", 300_000);
    return { uri: "file:///cache/large.jpg", width: 320, height: 640 };
  });
  await expect(
    prepareRetainedMealPhoto("owner-a", { uri: "source" }),
  ).rejects.toThrow("compressed");
  expect(mocks.save).toHaveBeenCalledTimes(3);
  expect(mocks.files.size).toBe(0);
});
it("survives restart/source removal and lost upload responses with one stable operation", async () => {
  const photo = descriptor();
  mocks.files.set(photo.uri, 500_000);
  expect(await persistMealPhotoRetry("owner-a", "meal-a", photo)).toBe(true);
  const copied = await loadMealPhotoRetry("owner-a", "meal-a");
  expect(copied?.uri).not.toBe(photo.uri);
  discardOwnedMealPhoto("owner-a", photo.uri);
  expect(await uploadMealPhotoRetry("owner-a", "meal-a", () => true)).toBe(
    false,
  );
  const pending = await loadMealPhotoRetry("owner-a", "meal-a");
  expect(pending?.width).toBe(320);
  expect(mocks.files.has(pending!.uri)).toBe(true);
  mocks.request.mockResolvedValueOnce({ ok: true });
  expect(await uploadMealPhotoRetry("owner-a", "meal-a", () => true)).toBe(
    true,
  );
  const bodies = mocks.request.mock.calls.map(([request]) => request.body);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0].clientOperationId).toBe(photo.clientOperationId);
  expect(await loadMealPhotoRetry("owner-a", "meal-a")).toBeNull();
  expect(mocks.files.size).toBe(0);
});
it("drops stale account completion and retains the old owner's retry", async () => {
  const photo = { ...descriptor(), width: 320, height: 640 };
  mocks.files.set(photo.uri, 50_000);
  await persistMealPhotoRetry("owner-a", "meal-a", photo);
  let current = true;
  mocks.request.mockImplementationOnce(async () => {
    current = false;
    return { ok: true };
  });
  expect(await uploadMealPhotoRetry("owner-a", "meal-a", () => current)).toBe(
    false,
  );
  expect(await loadMealPhotoRetry("owner-a", "meal-a")).not.toBeNull();
  expect(await loadMealPhotoRetry("owner-b", "meal-a")).toBeNull();
});
it("keeps independent copies when two queued meals share the same source", async () => {
  const photo = descriptor();
  mocks.files.set(photo.uri, 500_000);
  await Promise.all([
    persistMealPhotoRetry("owner-a", "meal-a", photo),
    persistMealPhotoRetry("owner-a", "meal-b", photo),
  ]);
  const first = await loadMealPhotoRetry("owner-a", "meal-a");
  const second = await loadMealPhotoRetry("owner-a", "meal-b");
  expect(first?.uri).not.toBe(second?.uri);
  await removeMealPhotoRetry("owner-a", "meal-a");
  expect(mocks.files.has(second!.uri)).toBe(true);
  expect(mocks.values.get("owner-a:meal-photo-index")).toEqual(["meal-b"]);
});
it("never deletes a camera-library original or other owner's path", () => {
  mocks.files.set("library-original", 1000);
  mocks.files.set(descriptor("owner-b").uri, 1000);
  discardOwnedMealPhoto("owner-a", "library-original");
  discardOwnedMealPhoto("owner-a", descriptor("owner-b").uri);
  expect(mocks.files.size).toBe(2);
});
it("requires Dev and the explicit manifest flag", () => {
  mocks.variant = "production";
  expect(mealPhotoRetentionEnabled()).toBe(false);
  mocks.variant = "dev";
  mocks.enabled = false;
  expect(mealPhotoRetentionEnabled()).toBe(false);
});
it("purges only the deleted owner and prevents late retry reinsertion", async () => {
  const owner = "deleted-owner";
  const photo = descriptor(owner);
  mocks.files.set(photo.uri, 10_000);
  mocks.files.set(descriptor("owner-b").uri, 10_000);
  await persistMealPhotoRetry(owner, "meal-a", photo);
  mocks.values.set(owner + ":meal", { name: "Other draft" });
  expect(await clearAllMealPhotoRetries(owner)).toBe(true);
  expect([...mocks.files.keys()]).toEqual([descriptor("owner-b").uri]);
  expect(mocks.values.has(owner + ":meal")).toBe(true);
  expect(await persistMealPhotoRetry(owner, "meal-b", photo)).toBe(false);
});

it("does not persist unindexed retries when index storage fails", async () => {
  const photo = descriptor();
  mocks.files.set(photo.uri, 500_000);
  mocks.indexFailure = true;
  expect(await persistMealPhotoRetry("owner-a", "meal-a", photo)).toBe(false);
  expect(await loadMealPhotoRetry("owner-a", "meal-a")).toBeNull();
  expect([...mocks.files.keys()]).toEqual([photo.uri]);
});
it("erases private pixels even when SecureStore cleanup fails", async () => {
  const owner = "failed-key-owner";
  const photo = descriptor(owner);
  mocks.files.set(photo.uri, 500_000);
  await persistMealPhotoRetry(owner, "meal-a", photo);
  mocks.clearFailure = true;
  expect(await clearAllMealPhotoRetries(owner)).toBe(false);
  expect([...mocks.files.keys()]).toHaveLength(0);
});
it("clears an in-flight retry write that completes after account purge", async () => {
  const owner = "late-write-owner";
  const photo = descriptor(owner);
  mocks.files.set(photo.uri, 50_000);
  let resume!: () => void;
  mocks.delayedWrite = () =>
    new Promise((done) => {
      resume = done;
    });
  const write = persistMealPhotoRetry(owner, "meal-a", photo);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await clearAllMealPhotoRetries(owner);
  resume();
  expect(await write).toBe(false);
  expect(await loadMealPhotoRetry(owner, "meal-a")).toBeNull();
  expect([...mocks.files.keys()]).toHaveLength(0);
});
