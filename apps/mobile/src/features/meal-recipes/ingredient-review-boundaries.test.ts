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

import { IngredientReviewController } from "./ingredient-review-controller";
import { EncryptedIngredientReviewStore } from "./ingredient-review-storage";
import { registerIngredientReviewRetirement } from "./ingredient-review-lifecycle";
import { clearRecipeIngredientData } from "./public-data";
const capabilities = {
  version: "meal-recipe-v1",
  suggest: true,
  recognizeIngredients: true,
  reason: "ready",
  maximumImages: 3,
  maximumTotalImageBytes: 4194304,
  maximumImageDimension: 4096,
  requiresIngredientConfirmation: true,
  requestIdRequired: true,
};
async function integrated() {
  const f = fixture();
  const values = new Map<string, string>();
  const store = new EncryptedIngredientReviewStore(
    {
      getItem: async (k) => values.get(k) ?? null,
      setItem: async (k, v) => {
        values.set(k, v);
      },
      removeItem: async (k) => {
        values.delete(k);
      },
    },
    () => 1000,
  );
  let id = 0;
  const api = {
    capabilities: async () => ({ ok: true, value: capabilities }),
    recognizeIngredients: vi.fn(),
    suggest: vi.fn(),
  };
  const controller = new IngredientReviewController({
    userId: "owner-a",
    api: api as any,
    store,
    photos: f.adapter,
    isCurrent: () => true,
    newId: () =>
      `00000000-0000-4000-8000-${(++id).toString().padStart(12, "0")}`,
    now: () => 1000,
  });
  await controller.init();
  await controller.addTyped("Beans");
  await controller.addPhoto({ source: "library", location: "fridge" });
  return { f, store, values, controller, api };
}
it("late analysis after successful retirement must not recreate an impossible cleanup", async () => {
  const x = await integrated();
  let resolve!: (v: any) => void;
  x.api.recognizeIngredients.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const analysis = x.controller.analyze();
  await vi.waitFor(() =>
    expect(x.api.recognizeIngredients).toHaveBeenCalledOnce(),
  );
  await x.controller.retireAi();
  expect(x.controller.getSnapshot().cleanupPending).toBe(0);
  resolve({ ok: false, error: { kind: "cancelled" } });
  await analysis;
  await x.controller.retryCleanup();
  expect(x.controller.getSnapshot().cleanupPending).toBe(0);
});
it("erasure must not be followed by retirement recovery resurrection", async () => {
  const x = await integrated();
  const wait = deferred();
  let entered = false;
  const remove = x.f.ports.remove;
  // The adapter captured the original ports object; update its mock implementation instead.
  vi.mocked(remove).mockImplementation(async (uri) => {
    if (uri.includes("ingredient-photos")) {
      entered = true;
      await wait.promise;
    }
    x.f.files.delete(uri);
  });
  const off = registerIngredientReviewRetirement("owner-a", (reason) =>
    reason === "account" ? x.controller.dispose() : x.controller.retireAi(),
  );
  const deleting = clearRecipeIngredientData("owner-a", {
    store: x.store,
    cleanupPhotos: async () => true,
  });
  await vi.waitFor(() => expect(entered).toBe(true));
  wait.resolve();
  await deleting;
  off();
  expect(await x.store.load("owner-a")).toBeNull();
  await x.controller.addTyped("After deletion");
  expect(await x.controller.confirm()).toBeNull();
  expect(await x.store.load("owner-a")).toBeNull();
});

it("confirmation without photo analysis still releases temporary photos before handoff", async () => {
  const x = await integrated();
  expect(x.controller.getSnapshot().photos).toHaveLength(1);
  const result = await x.controller.confirm();
  expect(result?.ingredients[0]?.name).toBe("Beans");
  expect(x.controller.getSnapshot().photos).toHaveLength(0);
  expect(
    [...x.f.files.keys()].filter((uri) => uri.includes("ingredient-photos/")),
  ).toHaveLength(0);
  expect(x.api.recognizeIngredients).not.toHaveBeenCalled();
});
