import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  variant: "dev",
  enabled: true,
  files: new Map<string, number>(),
  values: new Map<string, unknown>(),
  request: vi.fn(),
  download: vi.fn(),
  resize: vi.fn(),
  save: vi.fn(),
  normalize: vi.fn(),
  delayedCopy: null as null | (() => Promise<void>),
  copyFailure: false,
  emptyCopy: false,
  sequence: 0,
  indexFailure: false,
  clearFailure: false,
  delayedWrite: null as null | (() => Promise<void>),
  saveLocal: vi.fn(),
  backupEnabled: true,
  localRecord: vi.fn((): { assetId: string | null } | null => null),
  downloadLocal: vi.fn(),
  localUri: vi.fn(),
  recordBackup: vi.fn(),
}));
const ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENTRY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
vi.mock("@/features/private-photos/local-photo-library", () => ({
  saveLocalPhoto: mocks.saveLocal,
  downloadLocalPhoto: mocks.downloadLocal,
  localPhotoUri: mocks.localUri,
  localPhotoRecord: mocks.localRecord,
  recordLocalPhotoBackup: mocks.recordBackup,
}));
vi.mock("@/features/private-photos/photo-backup-preference", () => ({
  loadPhotoBackupEnabled: async () => mocks.backupEnabled,
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
    parts
      .map((part, index) => {
        const value = typeof part === "string" ? part : part.uri;
        return index === 0
          ? value.replace(/\/+$/, "")
          : value.replace(/^\/+|\/+$/g, "");
      })
      .join("/");
  class File {
    static downloadFileAsync = (url: string, destination: File) =>
      mocks.download(url, destination);
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
      const task = (async () => {
        if (mocks.delayedCopy) await mocks.delayedCopy();
        if (!this.exists) throw new Error("Missing");
        // A failed native copy may leave a partial destination.
        mocks.files.set(destination.uri, mocks.emptyCopy ? 0 : this.size);
        if (mocks.copyFailure) throw new Error("Copy failed");
      })();
      void task.catch(() => {});
      return task;
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
      this.uri = uri(parts) + "/";
    }
    create() {}
    get exists() {
      return [...mocks.files.keys()].some((key) => key.startsWith(this.uri));
    }
    delete() {
      for (const key of mocks.files.keys())
        if (key.startsWith(this.uri)) mocks.files.delete(key);
    }
  }
  return { File, Directory, Paths: { document: { uri: "file:///documents" } } };
});
vi.mock("./meal-photo", () => ({ normalizeMealPhoto: mocks.normalize }));
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
  backUpLocalMealPhoto,
  ensureMealPhotoOnDevice,
  keepMealPhotoOnDevice,
  clearAllMealPhotoRetries,
  discardOwnedMealPhoto,
  loadMealPhotoRetry,
  mealPhotoRetentionEnabled,
  persistMealPhotoRetry,
  persistMealPhotoSource,
  prepareRetainedMealPhoto,
  prepareCopiedMealPhoto,
  removeMealPhotoRetry,
  uploadMealPhotoRetry,
} from "./meal-photo-retention";
import { File } from "expo-file-system";
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
  mocks.delayedCopy = null;
  mocks.copyFailure = false;
  mocks.emptyCopy = false;
  mocks.variant = "dev";
  mocks.enabled = true;
  vi.clearAllMocks();
  mocks.download.mockReset().mockImplementation(async (_url, file) => {
    mocks.files.set(file.uri, 100);
    return file;
  });
  mocks.request.mockResolvedValue({ ok: false });
  mocks.saveLocal.mockReset().mockResolvedValue("file:///documents/local.jpg");
  mocks.downloadLocal
    .mockReset()
    .mockResolvedValue("file:///documents/downloaded.jpg");
  mocks.localUri.mockReset().mockReturnValue(null);
  mocks.recordBackup.mockReset().mockReturnValue(true);
  mocks.normalize.mockImplementation(async () => {
    const file = new File("file:///cache/normalized.jpg");
    mocks.files.set(file.uri, 500_000);
    return file;
  });
  mocks.save.mockImplementation(async () => {
    const uri = `file:///cache/thumbnail-${++mocks.sequence}.jpg`;
    mocks.files.set(uri, 50_000);
    return { uri, width: 320, height: 640 };
  });
});
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
it("keeps the normalized source until its durable asynchronous copy finishes", async () => {
  let release!: () => void;
  mocks.delayedCopy = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  let settled = false;
  const task = persistMealPhotoSource("owner-a", { uri: "library-original" });
  void task.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await flush();
  const settledBeforeCopy = settled;
  const sourceExistsBeforeCopy = mocks.files.has(
    "file:///cache/normalized.jpg",
  );
  release();
  const photo = await task;
  expect(settledBeforeCopy).toBe(false);
  expect(sourceExistsBeforeCopy).toBe(true);
  expect(mocks.files.has(photo.uri)).toBe(true);
  expect(mocks.files.has("file:///cache/normalized.jpg")).toBe(false);
});
it("keeps the thumbnail cache until its asynchronous durable copy finishes", async () => {
  let release!: () => void;
  mocks.delayedCopy = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  let settled = false;
  const task = prepareRetainedMealPhoto("owner-a", { uri: "library-original" });
  void task.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await flush();
  const settledBeforeCopy = settled;
  const cachedBeforeCopy = [...mocks.files.keys()].some((uri) =>
    uri.startsWith("file:///cache/"),
  );
  release();
  const photo = await task;
  expect(settledBeforeCopy).toBe(false);
  expect(cachedBeforeCopy).toBe(true);
  expect(mocks.files.has(photo.uri)).toBe(true);
});
it("publishes a retry only after its independent copy exists", async () => {
  const photo = descriptor();
  mocks.files.set(photo.uri, 500_000);
  let release!: () => void;
  mocks.delayedCopy = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const task = persistMealPhotoRetry("owner-a", "meal-a", photo);
  await flush();
  const publishedBeforeCopy = await loadMealPhotoRetry("owner-a", "meal-a");
  release();
  expect(await task).toBe(true);
  expect(publishedBeforeCopy).toBeNull();
  const retry = await loadMealPhotoRetry("owner-a", "meal-a");
  discardOwnedMealPhoto("owner-a", photo.uri);
  expect(mocks.files.has(retry!.uri)).toBe(true);
});
it("cleans failed source and thumbnail copies without publishing missing files", async () => {
  mocks.copyFailure = true;
  await expect(
    persistMealPhotoSource("owner-a", { uri: "library-original" }),
  ).rejects.toThrow("Copy failed");
  expect(mocks.files.size).toBe(0);
  await expect(
    prepareRetainedMealPhoto("owner-a", { uri: "library-original" }),
  ).rejects.toThrow("Copy failed");
  expect(mocks.files.size).toBe(0);
});
it("preserves the original and removes a partial retry after copy rejection", async () => {
  const photo = descriptor();
  mocks.files.set(photo.uri, 500_000);
  mocks.copyFailure = true;
  expect(await persistMealPhotoRetry("owner-a", "meal-a", photo)).toBe(false);
  expect(await loadMealPhotoRetry("owner-a", "meal-a")).toBeNull();
  expect([...mocks.files.keys()]).toEqual([photo.uri]);
});
it("removes a late copy after the owner's account data has been cleared", async () => {
  const owner = "deleted-during-copy";
  let release!: () => void;
  mocks.delayedCopy = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const task = persistMealPhotoSource(owner, { uri: "library-original" });
  await flush();
  expect(await clearAllMealPhotoRetries(owner)).toBe(true);
  release();
  await expect(task).rejects.toThrow("Account data was cleared");
  expect(mocks.files.size).toBe(0);
});
it.each(["thumbnail", "retry"])(
  "does not retain a late %s copy after account cleanup",
  async (kind) => {
    const owner = `deleted-during-${kind}-copy`;
    const source = descriptor(owner);
    if (kind === "retry") mocks.files.set(source.uri, 500_000);
    let release!: () => void;
    mocks.delayedCopy = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const task = (
      kind === "retry"
        ? persistMealPhotoRetry(owner, "meal-a", source)
        : prepareRetainedMealPhoto(owner, { uri: "library-original" })
    ).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await flush();
    expect(await clearAllMealPhotoRetries(owner)).toBe(true);
    release();
    const outcome = await task;
    if (kind === "retry") expect(outcome).toEqual({ value: false });
    else
      expect(outcome).toMatchObject({
        error: new Error("Account data was cleared."),
      });
    expect(await loadMealPhotoRetry(owner, "meal-a")).toBeNull();
    expect(mocks.files.size).toBe(0);
  },
);
it("rejects and cleans an empty destination even if native copy resolves", async () => {
  mocks.emptyCopy = true;
  await expect(
    persistMealPhotoSource("owner-a", { uri: "library-original" }),
  ).rejects.toThrow("could not be saved");
  expect(mocks.files.size).toBe(0);
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
  mocks.request.mockResolvedValueOnce({
    ok: true,
    value: { photo: { assetId: ASSET } },
  });
  expect(await uploadMealPhotoRetry("owner-a", "meal-a", () => true)).toBe(
    true,
  );
  // The uploaded thumbnail is also kept on this phone with its backup asset.
  expect(mocks.saveLocal).toHaveBeenCalledWith(
    "owner-a",
    "meal",
    "meal-a",
    pending!.uri,
    expect.objectContaining({ assetId: ASSET }),
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
it("recognizes an owned file when native directory URIs end with a slash", () => {
  const photo = descriptor();
  mocks.files.set(photo.uri, 1000);
  discardOwnedMealPhoto("owner-a", photo.uri);
  expect(mocks.files.has(photo.uri)).toBe(false);
});
it("follows only the explicit manifest flag in either variant", () => {
  mocks.variant = "production";
  expect(mealPhotoRetentionEnabled()).toBe(true);
  mocks.enabled = false;
  expect(mealPhotoRetentionEnabled()).toBe(false);
  mocks.variant = "dev";
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

const copiedSource = {
  ok: true,
  value: {
    photo: {
      assetId: "source",
      width: 200,
      height: 100,
      signedUrl: "https://storage.example.test/private-signed",
      expiresAt: "2026-10-12T12:00:00Z",
    },
  },
};
it("downloads an independent private photo with owner and request fences", async () => {
  mocks.request.mockResolvedValue(copiedSource);
  const valid = () => true;
  const copied = await prepareCopiedMealPhoto("owner-a", "source-entry", valid);
  expect(mocks.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: "/v1/food-entries/source-entry/photo",
      expectedUserId: "owner-a",
      isCurrent: valid,
    }),
  );
  expect(copied).toMatchObject({ width: 200, height: 100 });
  expect(copied.uri).toMatch(
    /^file:\/\/\/documents\/meal-photo-drafts\/owner-a\//,
  );
  expect(mocks.files.get(copied.uri)).toBe(100);
  expect(JSON.stringify(copied)).not.toContain("private-signed");
});
it("cleans a partial native download after rejection", async () => {
  mocks.request.mockResolvedValue(copiedSource);
  mocks.download.mockImplementation(async (_url, file) => {
    mocks.files.set(file.uri, 20);
    throw new Error("Download failed");
  });
  await expect(
    prepareCopiedMealPhoto("owner-a", "source-entry", () => true),
  ).rejects.toThrow();
  expect(mocks.files.size).toBe(0);
});
it.each([0, 256 * 1024 + 1])(
  "cleans invalid copied photo byte size %s",
  async (size) => {
    mocks.request.mockResolvedValue(copiedSource);
    mocks.download.mockImplementation(async (_url, file) => {
      mocks.files.set(file.uri, size);
      return file;
    });
    await expect(
      prepareCopiedMealPhoto("owner-a", "source-entry", () => true),
    ).rejects.toThrow();
    expect(mocks.files.size).toBe(0);
  },
);
it("cleans downloaded bytes when the session changes during download", async () => {
  let current = true;
  mocks.request.mockResolvedValue(copiedSource);
  mocks.download.mockImplementation(async (_url, file) => {
    mocks.files.set(file.uri, 100);
    current = false;
    return file;
  });
  await expect(
    prepareCopiedMealPhoto("owner-a", "source-entry", () => current),
  ).rejects.toThrow();
  expect(mocks.files.size).toBe(0);
});
it("cleans late downloads after account data was erased", async () => {
  const owner = "erased-during-download";
  mocks.request.mockResolvedValue(copiedSource);
  mocks.download.mockImplementation(async (_url, file) => {
    await clearAllMealPhotoRetries(owner);
    mocks.files.set(file.uri, 100);
    return file;
  });
  await expect(
    prepareCopiedMealPhoto(owner, "source-entry", () => true),
  ).rejects.toThrow();
  expect(mocks.files.size).toBe(0);
});
it("does not download denied source photos", async () => {
  await expect(
    prepareCopiedMealPhoto("owner-a", "source-entry", () => true),
  ).rejects.toThrow();
  expect(mocks.download).not.toHaveBeenCalled();
});
it("passes the same owner/current fence through retry upload dispatch", async () => {
  const photo = { ...descriptor(), width: 200, height: 100 };
  mocks.files.set(photo.uri, 100);
  await persistMealPhotoRetry("owner-a", "target", photo);
  const valid = () => true;
  await uploadMealPhotoRetry("owner-a", "target", valid);
  expect(mocks.request).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedUserId: "owner-a",
      isCurrent: valid,
      path: "/v1/food-entries/target/photo",
    }),
  );
});

it("moves staging metadata to the destination retry without deleting its shared local bytes", async () => {
  const photo = { ...descriptor(), width: 200, height: 100 };
  mocks.files.set(photo.uri, 100);
  await persistMealPhotoRetry("owner-a", "copy-operation", photo);
  await persistMealPhotoRetry("owner-a", "target", photo);
  await removeMealPhotoRetry("owner-a", "copy-operation", false);
  expect(await loadMealPhotoRetry("owner-a", "copy-operation")).toBeNull();
  expect(await loadMealPhotoRetry("owner-a", "target")).toEqual(photo);
  expect(mocks.files.get(photo.uri)).toBe(100);
  await removeMealPhotoRetry("owner-a", "target");
  expect(mocks.files.has(photo.uri)).toBe(false);
});

it("keeps the retry and the device untouched when a legacy upload is rejected", async () => {
  const photo = { ...descriptor(), width: 200, height: 100 };
  mocks.files.set(photo.uri, 100);
  await persistMealPhotoRetry("owner-a", "target", photo);
  mocks.request.mockResolvedValueOnce({ ok: false });
  expect(await uploadMealPhotoRetry("owner-a", "target", () => true)).toBe(
    false,
  );
  expect(mocks.saveLocal).not.toHaveBeenCalled();
  expect(await loadMealPhotoRetry("owner-a", "target")).toEqual(photo);
});

it("keeps a reduced thumbnail on the device under the new entry id and cleans the temporary file", async () => {
  mocks.files.set("file:///cache/chosen.jpg", 800_000);
  expect(
    await keepMealPhotoOnDevice("owner-a", ENTRY, "file:///cache/chosen.jpg"),
  ).toBe(true);
  expect(mocks.saveLocal).toHaveBeenCalledTimes(1);
  const [owner, kind, key, uri, options] = mocks.saveLocal.mock.calls[0]!;
  expect([owner, kind, key]).toEqual(["owner-a", "meal", ENTRY]);
  expect(uri).not.toBe("file:///cache/chosen.jpg");
  expect(options.assetId).toBeUndefined();
  expect(mocks.request).not.toHaveBeenCalled();
});

it("reports a device-save failure without throwing", async () => {
  mocks.files.set("file:///cache/chosen.jpg", 800_000);
  mocks.saveLocal.mockResolvedValueOnce(null);
  expect(
    await keepMealPhotoOnDevice("owner-a", ENTRY, "file:///cache/chosen.jpg"),
  ).toBe(false);
});

it("returns false when the chosen photo cannot be prepared", async () => {
  mocks.save.mockRejectedValueOnce(new Error("decode failed"));
  mocks.files.set("file:///cache/chosen.jpg", 800_000);
  expect(
    await keepMealPhotoOnDevice("owner-a", ENTRY, "file:///cache/chosen.jpg"),
  ).toBe(false);
  expect(mocks.saveLocal).not.toHaveBeenCalled();
});

it("uploads the device copy and records the returned backup asset", async () => {
  mocks.files.set("file:///documents/local.jpg", 50_000);
  mocks.localUri.mockReturnValue("file:///documents/local.jpg");
  mocks.request.mockResolvedValueOnce({
    ok: true,
    value: { photo: { assetId: ASSET } },
  });
  const valid = () => true;
  expect(await backUpLocalMealPhoto("owner-a", ENTRY, valid)).toBe(true);
  expect(mocks.request).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "POST",
      path: `/v1/food-entries/${ENTRY}/photo`,
      expectedUserId: "owner-a",
      isCurrent: valid,
      body: expect.objectContaining({
        imageBase64: "safe-jpeg-pixels",
        mimeType: "image/jpeg",
      }),
    }),
  );
  expect(mocks.recordBackup).toHaveBeenCalledWith(
    "owner-a",
    "meal",
    ENTRY,
    ASSET,
  );
});

it("does not upload without a device copy, when retired, disabled or no longer current, and does not record failed uploads", async () => {
  expect(await backUpLocalMealPhoto("owner-a", ENTRY, () => true)).toBe(false);
  mocks.files.set("file:///documents/local.jpg", 50_000);
  mocks.localUri.mockReturnValue("file:///documents/local.jpg");
  expect(await backUpLocalMealPhoto("owner-a", ENTRY, () => false)).toBe(false);
  mocks.enabled = false;
  expect(await backUpLocalMealPhoto("owner-a", ENTRY, () => true)).toBe(false);
  mocks.enabled = true;
  mocks.request.mockResolvedValueOnce({ ok: false });
  expect(await backUpLocalMealPhoto("owner-a", ENTRY, () => true)).toBe(false);
  expect(mocks.recordBackup).not.toHaveBeenCalled();
});

it("returns the device copy without any network request when the phone already has it", async () => {
  mocks.localUri.mockReturnValue("file:///documents/local.jpg");
  expect(await ensureMealPhotoOnDevice("owner-a", ENTRY, () => true)).toBe(
    "file:///documents/local.jpg",
  );
  expect(mocks.request).not.toHaveBeenCalled();
});

it("downloads a backed-up photo onto the device when the phone lacks it", async () => {
  mocks.request.mockResolvedValueOnce({
    ok: true,
    value: {
      photo: { assetId: ASSET, signedUrl: "https://private.example/p" },
    },
  });
  expect(await ensureMealPhotoOnDevice("owner-a", ENTRY, () => true)).toBe(
    "file:///documents/downloaded.jpg",
  );
  expect(mocks.downloadLocal).toHaveBeenCalledWith(
    "owner-a",
    "meal",
    ENTRY,
    "https://private.example/p",
    expect.objectContaining({ assetId: ASSET }),
  );
});

it("returns null when the backup cannot be read or the scope changed", async () => {
  mocks.request.mockResolvedValueOnce({ ok: false });
  expect(
    await ensureMealPhotoOnDevice("owner-a", ENTRY, () => true),
  ).toBeNull();
  mocks.request.mockResolvedValueOnce({ ok: true, value: { photo: null } });
  expect(
    await ensureMealPhotoOnDevice("owner-a", ENTRY, () => true),
  ).toBeNull();
  mocks.request.mockResolvedValueOnce({
    ok: true,
    value: { photo: { assetId: ASSET, signedUrl: "https://x" } },
  });
  expect(
    await ensureMealPhotoOnDevice("owner-a", ENTRY, () => false),
  ).toBeNull();
  expect(mocks.downloadLocal).not.toHaveBeenCalled();
});

it("keeps a legacy pending photo on the device without uploading while Back up photos is off", async () => {
  const photo = { ...descriptor(), width: 200, height: 100 };
  mocks.files.set(photo.uri, 100);
  await persistMealPhotoRetry("owner-a", "target", photo);
  mocks.backupEnabled = false;
  mocks.saveLocal.mockResolvedValueOnce("file:///documents/kept.jpg");
  try {
    expect(await uploadMealPhotoRetry("owner-a", "target", () => true)).toBe(
      true,
    );
  } finally {
    mocks.backupEnabled = true;
  }
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.saveLocal).toHaveBeenCalledWith(
    "owner-a",
    "meal",
    "target",
    photo.uri,
    expect.not.objectContaining({ assetId: expect.anything() }),
  );
  expect(await loadMealPhotoRetry("owner-a", "target")).toBeNull();
});

it("downloads a newer backup over a stale device copy but keeps a device-only copy", async () => {
  const NEWER = "33333333-3333-4333-8333-333333333333";
  mocks.request.mockReset();
  mocks.localUri.mockReturnValue("file:///documents/old.jpg");
  mocks.localRecord.mockReturnValueOnce({ assetId: ASSET });
  mocks.request.mockResolvedValueOnce({
    ok: true,
    value: {
      photo: { assetId: NEWER, signedUrl: "https://private.example/n" },
    },
  });
  expect(
    await ensureMealPhotoOnDevice(
      "owner-a",
      ENTRY,
      () => true,
      undefined,
      NEWER,
    ),
  ).toBe("file:///documents/downloaded.jpg");
  expect(mocks.downloadLocal).toHaveBeenCalledWith(
    "owner-a",
    "meal",
    ENTRY,
    "https://private.example/n",
    expect.objectContaining({ assetId: NEWER }),
  );
  mocks.request.mockClear();
  mocks.localRecord.mockReturnValueOnce({ assetId: null });
  expect(
    await ensureMealPhotoOnDevice(
      "owner-a",
      ENTRY,
      () => true,
      undefined,
      NEWER,
    ),
  ).toBe("file:///documents/old.jpg");
  expect(mocks.request).not.toHaveBeenCalled();
  mocks.localUri.mockReset();
});
