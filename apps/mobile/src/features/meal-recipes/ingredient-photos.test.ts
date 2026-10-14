import { describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  platform: "ios",
  fileSize: 12,
  requestLibrary: vi.fn(),
  getLibrary: vi.fn(),
  requestCamera: vi.fn(),
  getCamera: vi.fn(),
  launchLibrary: vi.fn(),
  launchCamera: vi.fn(),
  copy: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return native.platform;
    },
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "native-id" }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache/" } },
  File: class {
    constructor(readonly uri: string) {}
    get size() {
      return native.fileSize;
    }
    copy(destination: { uri: string }): Promise<void> {
      return native.copy(this.uri, destination.uri);
    }
  },
  Directory: class {},
}));
vi.mock("expo-image-manipulator", () => ({ ImageManipulator: {} }));
vi.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: native.requestLibrary,
  getMediaLibraryPermissionsAsync: native.getLibrary,
  requestCameraPermissionsAsync: native.requestCamera,
  getCameraPermissionsAsync: native.getCamera,
  launchImageLibraryAsync: native.launchLibrary,
  launchCameraAsync: native.launchCamera,
}));
vi.mock("@/features/log-meal/public-data", () => ({
  normalizeMealPhoto: vi.fn(),
}));

import {
  createIngredientPhotoAdapter,
  type IngredientPhoto,
  type IngredientPhotoAdapterPorts,
  type IngredientPhotoPickInput,
} from "./ingredient-photos";

const CACHE = "file:///cache/";
const RAW = "file:///library/original.heic";
const NORMALIZED = `${CACHE}ImageManipulator/normalized.jpg`;
const jpeg = (size = 12) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff]);
  bytes.set([0xff, 0xd9], size - 2);
  return bytes;
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const fixture = (initial: readonly string[] = []) => {
  let sequence = 0;
  let current = true;
  const files = new Map<string, Uint8Array>(
    initial.map((uri) => [uri, jpeg()]),
  );
  files.set(RAW, jpeg());
  const deleteFailures = new Set<string>();
  const ports: IngredientPhotoAdapterPorts = {
    cacheUri: CACHE,
    createId: () => `photo-${++sequence}`,
    permission: vi.fn(async () => true),
    launch: vi.fn(async () => ({
      cancelled: false,
      assets: [{ uri: RAW, type: "image", mimeType: "image/heic" }],
    })),
    pendingPicker: vi.fn(async () => null),
    dimensions: vi.fn(async (uri) =>
      uri === RAW
        ? { width: 4000, height: 6000 }
        : { width: 1365, height: 2048 },
    ),
    normalize: vi.fn(async (_asset, track) => {
      files.set(NORMALIZED, jpeg());
      track(NORMALIZED);
      return { uri: NORMALIZED };
    }),
    stat: vi.fn(async (uri) => ({
      exists: files.has(uri),
      size: files.get(uri)?.length ?? 0,
    })),
    bytes: vi.fn(async (uri) => files.get(uri) ?? new Uint8Array()),
    ensureDirectory: vi.fn(async () => {}),
    copy: vi.fn(async (source, destination) => {
      files.set(destination, files.get(source)!.slice());
    }),
    remove: vi.fn(async (uri) => {
      if (deleteFailures.has(uri)) throw new Error("synthetic failure");
      files.delete(uri);
    }),
    listFiles: vi.fn(async (directory) =>
      [...files.keys()].filter((uri) => uri.startsWith(directory)),
    ),
    blob: vi.fn(
      async (uri) =>
        new Blob([new Uint8Array(files.get(uri)!)], { type: "image/jpeg" }),
    ),
  };
  const input = (
    extra: Partial<IngredientPhotoPickInput> = {},
  ): IngredientPhotoPickInput => ({
    source: "library",
    location: "fridge",
    userId: "owner-a",
    isCurrent: () => current,
    maximumImages: 3,
    existing: [],
    ...extra,
  });
  const adapter = createIngredientPhotoAdapter(ports);
  const selected = async (extra: Partial<IngredientPhotoPickInput> = {}) => {
    const result = await adapter.pick(input(extra));
    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") throw new Error("Expected selection.");
    return result.photo;
  };
  return {
    adapter,
    ports,
    files,
    deleteFailures,
    input,
    selected,
    setCurrent: (value: boolean) => {
      current = value;
    },
  };
};

describe.each(["ios", "android"])(
  "temporary ingredient photos (%s synthetic ports)",
  (platform) => {
    it("normalizes HEIC with decoded orientation/dimensions and returns only managed JPEG", async () => {
      native.platform = platform;
      const f = fixture();
      const photo = await f.selected();
      expect(f.ports.normalize).toHaveBeenCalledWith(
        { uri: RAW, width: 4000, height: 6000 },
        expect.any(Function),
      );
      expect(photo).toEqual({
        id: "photo-1",
        location: "fridge",
        uri: `${CACHE}ingredient-photos/owner-a/photo-1.jpg`,
        mimeType: "image/jpeg",
        byteSize: 12,
        width: 1365,
        height: 2048,
      });
      expect(f.files.has(NORMALIZED)).toBe(false);
      expect(f.files.has(RAW)).toBe(true);
      expect((await f.adapter.toUpload(photo)).photo.type).toBe("image/jpeg");
      expect(await f.adapter.release(photo)).toBe(true);
      expect(f.files.has(photo.uri)).toBe(false);
      expect(f.files.has(RAW)).toBe(true);
      await expect(f.adapter.toUpload(photo)).rejects.toThrow(
        "Reselect this photo.",
      );
    });

    it("supports deliberate camera and separate fridge/cabinet captures", async () => {
      const f = fixture();
      const fridge = await f.selected({ source: "camera" });
      const cabinet = await f.selected({
        source: "library",
        location: "cabinet",
        existing: [fridge],
      });
      expect(f.ports.launch).toHaveBeenNthCalledWith(1, "camera");
      expect(f.ports.launch).toHaveBeenNthCalledWith(2, "library");
      expect(cabinet.location).toBe("cabinet");
      expect(cabinet.uri).not.toBe(fridge.uri);
      expect(await f.adapter.cleanupForUser("owner-a")).toBe(true);
      expect([...f.files.keys()]).toEqual([RAW]);
    });

    it("cancels without decoding, deleting positively returned picker cache copies only", async () => {
      const f = fixture();
      const owned = `${CACHE}ImagePicker/cancelled.jpg`;
      f.files.set(owned, jpeg());
      vi.mocked(f.ports.launch).mockResolvedValue({
        cancelled: true,
        assets: [{ uri: owned }, { uri: RAW }],
      });
      expect(await f.adapter.pick(f.input())).toEqual({ kind: "cancelled" });
      expect(f.ports.dimensions).not.toHaveBeenCalled();
      expect(f.files.has(owned)).toBe(false);
      expect(f.files.has(RAW)).toBe(true);
    });

    it("reports denied and revoked permission without admitting a photo", async () => {
      const f = fixture();
      vi.mocked(f.ports.permission).mockResolvedValueOnce(false);
      expect(await f.adapter.pick(f.input())).toEqual({ kind: "denied" });
      expect(f.ports.launch).not.toHaveBeenCalled();
      const owned = `${CACHE}ImagePicker/revoked.jpg`;
      f.files.set(owned, jpeg());
      vi.mocked(f.ports.launch).mockResolvedValueOnce({
        cancelled: false,
        assets: [{ uri: owned }],
      });
      vi.mocked(f.ports.permission)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      expect(await f.adapter.pick(f.input())).toEqual({ kind: "denied" });
      expect(f.files.has(owned)).toBe(false);
      expect(f.ports.normalize).not.toHaveBeenCalled();
    });

    it.each(["application/pdf", "video/mp4", "image/gif"])(
      "rejects invalid MIME %s",
      async (mimeType) => {
        const f = fixture();
        vi.mocked(f.ports.launch).mockResolvedValue({
          cancelled: false,
          assets: [{ uri: RAW, mimeType }],
        });
        expect(await f.adapter.pick(f.input())).toEqual({ kind: "invalid" });
        expect(f.ports.normalize).not.toHaveBeenCalled();
        expect(f.files.has(RAW)).toBe(true);
      },
    );

    it("rejects corrupt decode and cleans a normalizer output exposed before failure", async () => {
      const f = fixture();
      vi.mocked(f.ports.dimensions).mockRejectedValueOnce(
        new Error("synthetic decode failure"),
      );
      expect(await f.adapter.pick(f.input())).toEqual({ kind: "invalid" });
      vi.mocked(f.ports.normalize).mockImplementationOnce(
        async (_asset, track) => {
          f.files.set(NORMALIZED, jpeg());
          track(NORMALIZED);
          throw new Error("synthetic save failure");
        },
      );
      expect(await f.adapter.pick(f.input())).toEqual({ kind: "invalid" });
      expect(f.files.has(NORMALIZED)).toBe(false);
    });

    it.each(["dimensions", "empty", "signature"])(
      "rejects invalid normalized %s",
      async (failure) => {
        const f = fixture();
        if (failure === "dimensions")
          vi.mocked(f.ports.dimensions)
            .mockResolvedValueOnce({ width: 3000, height: 2000 })
            .mockResolvedValueOnce({ width: 4097, height: 100 });
        else
          vi.mocked(f.ports.normalize).mockImplementationOnce(
            async (_asset, track) => {
              f.files.set(
                NORMALIZED,
                failure === "empty" ? new Uint8Array() : new Uint8Array(12),
              );
              track(NORMALIZED);
              return { uri: NORMALIZED };
            },
          );
        expect(await f.adapter.pick(f.input())).toEqual({ kind: "invalid" });
        expect(f.files.has(NORMALIZED)).toBe(false);
      },
    );

    it("enforces one/basic, three/advanced and aggregate four MiB even with omitted existing list", async () => {
      const f = fixture();
      await f.selected({ maximumImages: 1 });
      expect(await f.adapter.pick(f.input({ maximumImages: 1 }))).toEqual({
        kind: "limit",
      });
      expect(f.ports.launch).toHaveBeenCalledTimes(1);
      await f.selected();
      await f.selected();
      expect(await f.adapter.pick(f.input())).toEqual({ kind: "limit" });
      expect(await f.adapter.cleanupForUser("owner-a")).toBe(true);
      vi.mocked(f.ports.normalize).mockImplementation(async (_asset, track) => {
        f.files.set(NORMALIZED, jpeg(2 * 1024 * 1024 + 1));
        track(NORMALIZED);
        return { uri: NORMALIZED };
      });
      await f.selected();
      expect(await f.adapter.pick(f.input())).toEqual({ kind: "limit" });
      expect(f.files.has(NORMALIZED)).toBe(false);
    });

    it("serializes concurrent picks against the same one-photo limit", async () => {
      const f = fixture();
      const results = await Promise.all([
        f.adapter.pick(f.input({ maximumImages: 1 })),
        f.adapter.pick(f.input({ maximumImages: 1 })),
      ]);
      expect(results.map((result) => result.kind)).toEqual([
        "selected",
        "limit",
      ]);
    });

    it("fences a late acquisition during logout and waits for its cleanup", async () => {
      const f = fixture();
      const entered = deferred();
      const finish = deferred();
      const owned = `${CACHE}ImagePicker/late.jpg`;
      vi.mocked(f.ports.launch).mockImplementationOnce(async () => {
        entered.resolve();
        await finish.promise;
        f.files.set(owned, jpeg());
        return { cancelled: false, assets: [{ uri: owned }] };
      });
      const pick = f.adapter.pick(f.input());
      await entered.promise;
      const cleaning = f.adapter.cleanupForUser("owner-a");
      finish.resolve();
      expect(await pick).toEqual({ kind: "cancelled" });
      expect(await cleaning).toBe(true);
      expect(f.files.has(owned)).toBe(false);
      expect(f.ports.normalize).not.toHaveBeenCalled();
    });

    it("fences late normalization and partial copy on owner replacement", async () => {
      const f = fixture();
      vi.mocked(f.ports.copy).mockImplementationOnce(
        async (_source, destination) => {
          f.files.set(destination, jpeg());
          f.setCurrent(false);
        },
      );
      expect(await f.adapter.pick(f.input())).toEqual({ kind: "cancelled" });
      expect([...f.files.keys()]).toEqual([RAW]);
      f.setCurrent(true);
      vi.mocked(f.ports.copy).mockImplementationOnce(
        async (_source, destination) => {
          f.files.set(destination, jpeg(5));
          throw new Error("synthetic partial copy");
        },
      );
      expect(await f.adapter.pick(f.input())).toEqual({ kind: "invalid" });
      expect([...f.files.keys()]).toEqual([RAW]);
    });

    it("keeps failed cleanup explicit and retries, preserving other owner bytes", async () => {
      const f = fixture();
      const other = await f.selected({ userId: "owner-b" });
      const photo = await f.selected();
      f.deleteFailures.add(photo.uri);
      expect(await f.adapter.release(photo)).toBe(false);
      await expect(f.adapter.toUpload(photo)).rejects.toThrow(
        "Reselect this photo.",
      );
      expect(await f.adapter.pick(f.input())).toEqual({
        kind: "cleanup_failed",
      });
      expect(await f.adapter.cleanupForUser("owner-a")).toBe(false);
      f.deleteFailures.clear();
      expect(await f.adapter.cleanupForUser("owner-a")).toBe(true);
      expect(f.files.has(other.uri)).toBe(true);
      expect(f.files.has(RAW)).toBe(true);
    });

    it("does not report successful removal when a native delete silently leaves bytes", async () => {
      const f = fixture();
      const photo = await f.selected();
      vi.mocked(f.ports.remove).mockResolvedValueOnce();
      expect(await f.adapter.release(photo)).toBe(false);
      expect(f.files.has(photo.uri)).toBe(true);
      expect(await f.adapter.release(photo)).toBe(true);
    });

    it("reports cleanup failure on failed normalization and discards failed selected output", async () => {
      const f = fixture();
      f.deleteFailures.add(NORMALIZED);
      expect(await f.adapter.pick(f.input())).toEqual({
        kind: "cleanup_failed",
      });
      expect(
        [...f.files.keys()].some((uri) => uri.includes("ingredient-photos/")),
      ).toBe(false);
      f.deleteFailures.clear();
      expect(await f.adapter.cleanupForUser("owner-a")).toBe(true);
      expect(f.files.has(NORMALIZED)).toBe(false);
    });

    it("rejects forged, traversing, cross-owner and released photo handles", async () => {
      const f = fixture();
      const photo = await f.selected();
      for (const uri of [
        RAW,
        `${CACHE}ingredient-photos/owner-a/../owner-b/photo.jpg`,
        `${CACHE}ingredient-photos/owner-a/%2e%2e/secret.jpg`,
      ]) {
        const forged = { ...photo, uri };
        expect(await f.adapter.release(forged)).toBe(false);
        await expect(f.adapter.toUpload(forged)).rejects.toThrow(
          "Reselect this photo.",
        );
      }
      expect(
        await f.adapter.pick(f.input({ userId: "owner-b", existing: [photo] })),
      ).toEqual({ kind: "invalid" });
      expect(await f.adapter.pick(f.input({ userId: "../owner-b" }))).toEqual({
        kind: "invalid",
      });
      expect(await f.adapter.cleanupForUser("../owner-b")).toBe(false);
      expect(f.files.has(photo.uri)).toBe(true);
    });

    it("sweeps only stale managed namespace files on startup and retains cleanup retries", async () => {
      const stale = `${CACHE}ingredient-photos/old-owner/stale.jpg`;
      const unrelated = `${CACHE}ImagePicker/another-meal.jpg`;
      const f = fixture([stale, unrelated]);
      const photo = await f.selected();
      expect(f.files.has(stale)).toBe(false);
      expect(f.files.has(unrelated)).toBe(true);
      expect(await f.adapter.recover()).toBe(true);
      expect(f.files.has(photo.uri)).toBe(true);
    });

    it("fences upload while account cleanup occurs during asynchronous blob conversion", async () => {
      const f = fixture();
      const photo = await f.selected();
      const entered = deferred();
      const finish = deferred();
      vi.mocked(f.ports.blob).mockImplementationOnce(async () => {
        entered.resolve();
        await finish.promise;
        return new Blob([jpeg()]);
      });
      const upload = f.adapter.toUpload(photo);
      await entered.promise;
      expect(await f.adapter.cleanupForUser("owner-a")).toBe(true);
      finish.resolve();
      await expect(upload).rejects.toThrow("Reselect this photo.");
    });
  },
);

it.each(["ios", "android"])(
  "native %s multipart descriptor has own URI, name, MIME and size",
  async (platform) => {
    native.platform = platform;
    const f = fixture();
    const { blob: _blob, ...ports } = f.ports;
    const nativeAdapter = createIngredientPhotoAdapter(ports);
    const result = await nativeAdapter.pick(f.input());
    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") throw new Error("Expected selection.");
    const upload = await nativeAdapter.toUpload(result.photo);
    expect({ ...upload.photo }).toEqual({
      uri: result.photo.uri,
      name: "ingredient-photo.jpg",
      type: "image/jpeg",
      size: 12,
    });
    expect(upload.mimeType).toBe("image/jpeg");
  },
);

it.each(["ios", "android"])(
  "native %s system library picker needs no broad media-library permission",
  async (platform) => {
    native.platform = platform;
    native.requestLibrary.mockClear();
    native.getLibrary.mockClear();
    native.requestCamera.mockClear();
    native.getCamera.mockClear();
    native.launchLibrary.mockClear();
    native.launchCamera.mockClear();
    native.launchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: RAW, type: "image", mimeType: "image/heic" }],
    });
    const f = fixture();
    const { permission: _permission, launch: _launch, ...ports } = f.ports;
    const adapter = createIngredientPhotoAdapter(ports);
    expect((await adapter.pick(f.input({ source: "library" }))).kind).toBe(
      "selected",
    );
    expect(native.launchLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        exif: false,
      }),
    );
    expect(native.requestLibrary).not.toHaveBeenCalled();
    expect(native.getLibrary).not.toHaveBeenCalled();
    expect(native.requestCamera).not.toHaveBeenCalled();
    expect(native.getCamera).not.toHaveBeenCalled();
    expect(native.launchCamera).not.toHaveBeenCalled();
  },
);

it("retries a failed startup namespace sweep and then permits fresh selection", async () => {
  const f = fixture();
  const stale = `${CACHE}ingredient-photos/owner-a/stale.jpg`;
  f.files.set(stale, jpeg());
  f.deleteFailures.add(stale);
  const adapter = createIngredientPhotoAdapter(f.ports);
  expect(await adapter.pick(f.input())).toEqual({ kind: "cleanup_failed" });
  f.deleteFailures.clear();
  expect(await adapter.recover()).toBe(true);
  expect((await adapter.pick(f.input())).kind).toBe("selected");
  expect(f.files.has(stale)).toBe(false);
});

it("discards positively returned native pending-result cache bytes and preserves original library bytes", async () => {
  const f = fixture();
  const pending = `${CACHE}ImagePicker/pending.jpg`;
  f.files.set(pending, jpeg());
  vi.mocked(f.ports.pendingPicker).mockResolvedValue({
    cancelled: false,
    assets: [{ uri: pending }, { uri: RAW }],
  });
  const adapter = createIngredientPhotoAdapter(f.ports);
  expect((await adapter.pick(f.input())).kind).toBe("selected");
  expect(f.files.has(pending)).toBe(false);
  expect(f.files.has(RAW)).toBe(true);
});

it("serializes explicit recovery behind an in-flight managed copy", async () => {
  const f = fixture();
  const entered = deferred();
  const finish = deferred();
  vi.mocked(f.ports.copy).mockImplementationOnce(
    async (source, destination) => {
      f.files.set(destination, f.files.get(source)!.slice());
      entered.resolve();
      await finish.promise;
    },
  );
  const selecting = f.adapter.pick(f.input());
  await entered.promise;
  const recovering = f.adapter.recover();
  finish.resolve();
  const selected = await selecting;
  expect(selected.kind).toBe("selected");
  expect(await recovering).toBe(true);
  if (selected.kind !== "selected") throw new Error("Expected selection.");
  expect(f.files.has(selected.photo.uri)).toBe(true);
});

it.each(["ios", "android"])(
  "native %s selection waits for asynchronous File.copy completion",
  async (platform) => {
    native.platform = platform;
    const f = fixture();
    const entered = deferred();
    const finish = deferred();
    native.copy.mockImplementationOnce(
      async (source: string, destination: string) => {
        entered.resolve();
        await finish.promise;
        f.files.set(destination, f.files.get(source)!.slice());
      },
    );
    const { copy: _copy, ...ports } = f.ports;
    const adapter = createIngredientPhotoAdapter(ports);
    const selecting = adapter.pick(f.input());
    await entered.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(
      vi
        .mocked(f.ports.stat)
        .mock.calls.filter(([uri]) => uri.includes("ingredient-photos/")),
    ).toEqual([]);
    finish.resolve();
    expect((await selecting).kind).toBe("selected");
  },
);

it.each(["ios", "android"])(
  "native %s rejected asynchronous File.copy cleans partial output",
  async (platform) => {
    native.platform = platform;
    const f = fixture();
    const entered = deferred();
    const finish = deferred();
    native.copy.mockImplementationOnce(
      async (_source: string, destination: string) => {
        entered.resolve();
        await finish.promise;
        f.files.set(destination, jpeg(5));
        throw new Error("synthetic native copy rejection");
      },
    );
    const { copy: _copy, ...ports } = f.ports;
    const adapter = createIngredientPhotoAdapter(ports);
    const selecting = adapter.pick(f.input());
    await entered.promise;
    finish.resolve();
    expect(await selecting).toEqual({ kind: "invalid" });
    expect([...f.files.keys()]).toEqual([RAW]);
  },
);
