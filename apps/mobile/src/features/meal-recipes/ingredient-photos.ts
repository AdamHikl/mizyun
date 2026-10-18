import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import { normalizeMealPhoto } from "@/features/log-meal/public-data";

export type IngredientPhotoLocation = "fridge" | "cabinet" | "other";
export type IngredientPhotoSource = "camera" | "library";
export interface IngredientPhoto {
  readonly id: string;
  readonly location: IngredientPhotoLocation;
  readonly uri: string;
  readonly mimeType: "image/jpeg";
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
}
export type IngredientPhotoPickResult =
  | { readonly kind: "selected"; readonly photo: IngredientPhoto }
  | {
      readonly kind:
        "cancelled" | "denied" | "invalid" | "limit" | "cleanup_failed";
    };
export interface IngredientPhotoPickInput {
  readonly source: IngredientPhotoSource;
  readonly location: IngredientPhotoLocation;
  readonly userId: string;
  readonly isCurrent: () => boolean;
  readonly maximumImages: 1 | 3;
  readonly existing: readonly IngredientPhoto[];
}
interface PhotoAsset {
  readonly uri: string;
  readonly type?: string | null;
  readonly mimeType?: string | null;
}
interface PickerResult {
  readonly cancelled: boolean;
  readonly assets: readonly PhotoAsset[];
  readonly temporaryUris?: readonly string[];
  readonly failed?: boolean;
}
export interface IngredientPhotoAdapterPorts {
  readonly cacheUri: string;
  readonly createId: () => string;
  readonly permission: (
    source: IngredientPhotoSource,
    request: boolean,
  ) => Promise<boolean>;
  readonly launch: (source: IngredientPhotoSource) => Promise<PickerResult>;
  readonly pendingPicker: () => Promise<PickerResult | null>;
  readonly dimensions: (
    uri: string,
  ) => Promise<{ width: number; height: number }>;
  readonly normalize: (
    asset: { uri: string; width: number; height: number },
    onTemporaryFile: (uri: string) => void,
  ) => Promise<{ uri: string }>;
  readonly stat: (uri: string) => Promise<{ exists: boolean; size: number }>;
  readonly bytes: (uri: string) => Promise<Uint8Array>;
  readonly ensureDirectory: (uri: string) => Promise<void>;
  readonly copy: (source: string, destination: string) => Promise<void>;
  readonly remove: (uri: string) => Promise<void>;
  readonly listFiles: (directory: string) => Promise<readonly string[]>;
  readonly blob: (uri: string) => Promise<Blob>;
}
export interface IngredientPhotoAdapter {
  pick(input: IngredientPhotoPickInput): Promise<IngredientPhotoPickResult>;
  release(photo: IngredientPhoto): Promise<boolean>;
  cleanupForUser(userId: string): Promise<boolean>;
  toUpload(
    photo: IngredientPhoto,
  ): Promise<{ photo: Blob; mimeType: "image/jpeg" }>;
  recover(): Promise<boolean>;
}

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_EDGE = 2048;
const safeSegment = (value: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const validDimensions = ({
  width,
  height,
}: {
  width: number;
  height: number;
}) =>
  Number.isSafeInteger(width) &&
  Number.isSafeInteger(height) &&
  width > 0 &&
  height > 0;
const nativeFiles = async (directory: string): Promise<string[]> => {
  const folder = new Directory(directory);
  if (!folder.exists) return [];
  const files: string[] = [];
  for (const entry of folder.list()) {
    if (entry instanceof Directory)
      files.push(...(await nativeFiles(entry.uri)));
    else files.push(entry.uri);
  }
  return files;
};
const defaultPorts = (): IngredientPhotoAdapterPorts => ({
  cacheUri: Paths.cache.uri,
  createId: randomUUID,
  permission: async (source, request) => {
    // SDK 57's system library picker grants access to the selected image.
    // Broad media-library permission is unnecessary for this deliberate selection.
    if (source === "library") return true;
    const result = await (request
      ? ImagePicker.requestCameraPermissionsAsync()
      : ImagePicker.getCameraPermissionsAsync());
    return result.granted;
  },
  launch: async (source) => {
    let result: ImagePicker.ImagePickerResult | null = null;
    let failed = false;
    try {
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        allowsEditing: false,
        allowsMultipleSelection: false,
        exif: false,
        base64: false,
        quality: 1,
      };
      result = await (source === "camera"
        ? ImagePicker.launchCameraAsync(options)
        : ImagePicker.launchImageLibraryAsync(options));
    } catch {
      failed = true;
    }
    return {
      cancelled: result?.canceled ?? false,
      assets: result?.assets ?? [],
      failed,
    };
  },
  pendingPicker: async () => {
    const pending = await ImagePicker.getPendingResultAsync();
    if (!pending || "code" in pending) return null;
    return { cancelled: pending.canceled, assets: pending.assets ?? [] };
  },
  dimensions: async (uri) => {
    const context = ImageManipulator.manipulate(uri);
    let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
    try {
      rendered = await context.renderAsync();
      return { width: rendered.width, height: rendered.height };
    } finally {
      rendered?.release();
      context.release();
    }
  },
  normalize: (asset, onTemporaryFile) =>
    normalizeMealPhoto(asset, {
      onTemporaryFile: (file) => onTemporaryFile(file.uri),
    }),
  stat: async (uri) => {
    const file = new File(uri);
    return { exists: file.exists, size: file.size };
  },
  bytes: (uri) => new File(uri).bytes(),
  ensureDirectory: async (uri) => {
    new Directory(uri).create({ intermediates: true, idempotent: true });
  },
  copy: async (source, destination) => {
    await new File(source).copy(new File(destination));
  },
  remove: async (uri) => {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
  listFiles: nativeFiles,
  // expo/fetch (the global fetch since SDK 57) encodes Blob/`bytes()` parts
  // only; React Native `{ uri }` descriptors throw before any request is sent.
  blob: async (uri) => new File(uri) as unknown as Blob,
});

/** Temporary photo ownership is in memory; recovery discards stale cache bytes. */
export const createIngredientPhotoAdapter = (
  overrides: Partial<IngredientPhotoAdapterPorts> = {},
): IngredientPhotoAdapter => {
  const ports = { ...defaultPorts(), ...overrides };
  const cache = `${ports.cacheUri.replace(/\/+$/, "")}/`;
  const root = `${cache}ingredient-photos/`;
  const generations = new Map<string, number>();
  const records = new Map<
    string,
    {
      owner: string;
      photo: IngredientPhoto;
      current: () => boolean;
      generation: number;
      active: boolean;
    }
  >();
  const cleanup = new Map<string, string>();
  const jobs = new Map<string, Set<Promise<IngredientPhotoPickResult>>>();
  const closing = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();
  let recoveryReady = false;
  const generation = (owner: string) => generations.get(owner) ?? 0;
  const cleanUri = (uri: string) => {
    if (!uri.startsWith("file://") || /[?#\\]/.test(uri)) return false;
    const path = uri.slice("file://".length);
    return !path
      .split("/")
      .some(
        (segment) =>
          segment === "." || segment === ".." || /%2e|%2f|%5c/i.test(segment),
      );
  };
  const managed = (uri: string) => cleanUri(uri) && uri.startsWith(root);
  const nativeTemporary = (uri: string) =>
    cleanUri(uri) &&
    (uri.startsWith(`${cache}ImagePicker/`) ||
      uri.startsWith(`${cache}ImageManipulator/`));
  const remember = (uri: string, owner: string) => {
    if (managed(uri) || nativeTemporary(uri)) cleanup.set(uri, owner);
  };
  const remove = async (uri: string): Promise<boolean> => {
    if (!managed(uri) && !nativeTemporary(uri)) return false;
    try {
      await ports.remove(uri);
      if ((await ports.stat(uri)).exists) return false;
      cleanup.delete(uri);
      return true;
    } catch {
      return false;
    }
  };
  const removeAll = async (uris: readonly string[]) => {
    const results = await Promise.all(uris.map(remove));
    return results.every(Boolean);
  };
  const recoverNow = async () => {
    try {
      for (const uri of await ports.listFiles(root)) {
        if (!managed(uri)) {
          recoveryReady = false;
          return false;
        }
        // A repeated recovery must not erase photos belonging to this live adapter.
        if (
          ![...records.values()].some(
            (record) => record.active && record.photo.uri === uri,
          )
        )
          remember(uri, "");
      }
      const pending = await ports.pendingPicker();
      for (const asset of pending?.assets ?? [])
        if (nativeTemporary(asset.uri)) remember(asset.uri, "");
      recoveryReady = await removeAll([...cleanup.keys()]);
      return recoveryReady;
    } catch {
      recoveryReady = false;
      return false;
    }
  };
  const startup = recoverNow();
  const recover = () => {
    const task = queue.then(recoverNow, recoverNow);
    queue = task;
    return task;
  };
  const stillCurrent = (isCurrent: () => boolean) => {
    try {
      return isCurrent();
    } catch {
      return false;
    }
  };
  const trusted = (photo: IngredientPhoto) => {
    const record = records.get(photo.id);
    if (
      !record ||
      !managed(photo.uri) ||
      Object.keys(record.photo).some(
        (key) =>
          record.photo[key as keyof IngredientPhoto] !==
          photo[key as keyof IngredientPhoto],
      )
    )
      return undefined;
    return record;
  };
  const ownerPhotos = (owner: string) =>
    [...records.values()].filter(
      (record) =>
        record.owner === owner &&
        record.active &&
        record.generation === generation(owner) &&
        stillCurrent(record.current),
    );
  const pick = (
    input: IngredientPhotoPickInput,
  ): Promise<IngredientPhotoPickResult> => {
    const captured = generation(input.userId);
    const run = async (): Promise<IngredientPhotoPickResult> => {
      const transient = new Set<string>();
      let destination: string | undefined;
      let selected: IngredientPhoto | undefined;
      let result: IngredientPhotoPickResult = { kind: "invalid" };
      const current = () =>
        captured === generation(input.userId) &&
        !closing.has(input.userId) &&
        stillCurrent(input.isCurrent);
      const track = (uri: string) => {
        if (nativeTemporary(uri) || managed(uri)) {
          remember(uri, input.userId);
          transient.add(uri);
        }
      };
      try {
        await startup;
        if (!recoveryReady || [...cleanup.values()].includes(input.userId))
          return { kind: "cleanup_failed" };
        if (
          !safeSegment(input.userId) ||
          !cleanUri(root) ||
          ![1, 3].includes(input.maximumImages) ||
          !["camera", "library"].includes(input.source) ||
          !["fridge", "cabinet", "other"].includes(input.location)
        )
          return { kind: "invalid" };
        if (!current()) return { kind: "cancelled" };
        if (
          input.existing.some(
            (photo) =>
              trusted(photo)?.owner !== input.userId || !trusted(photo)?.active,
          )
        )
          return { kind: "invalid" };
        if (ownerPhotos(input.userId).length >= input.maximumImages)
          return { kind: "limit" };
        if (!(await ports.permission(input.source, true)))
          return { kind: "denied" };
        if (!current()) return { kind: "cancelled" };
        const picked = await ports.launch(input.source);
        for (const uri of picked.temporaryUris ?? []) track(uri);
        for (const asset of picked.assets)
          if (nativeTemporary(asset.uri)) track(asset.uri);
        if (!current() || picked.cancelled) result = { kind: "cancelled" };
        else if (picked.failed) result = { kind: "invalid" };
        else if (!(await ports.permission(input.source, false)))
          result = { kind: "denied" };
        else if (picked.assets.length !== 1) result = { kind: "invalid" };
        else {
          const asset = picked.assets[0];
          if (!current()) result = { kind: "cancelled" };
          else if (
            !/^(file|content):\/\//.test(asset.uri) ||
            (asset.type != null && asset.type !== "image") ||
            (asset.mimeType != null &&
              !/^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(asset.mimeType))
          )
            result = { kind: "invalid" };
          else {
            const dimensions = await ports.dimensions(asset.uri);
            if (!validDimensions(dimensions)) throw new Error("Invalid photo.");
            if (!current()) result = { kind: "cancelled" };
            else {
              const normalized = await ports.normalize(
                { uri: asset.uri, ...dimensions },
                track,
              );
              track(normalized.uri);
              if (
                !nativeTemporary(normalized.uri) ||
                normalized.uri === asset.uri
              )
                throw new Error("Invalid photo.");
              const info = await ports.stat(normalized.uri);
              const actual = await ports.dimensions(normalized.uri);
              if (
                !info.exists ||
                !Number.isSafeInteger(info.size) ||
                info.size <= 0 ||
                !validDimensions(actual) ||
                Math.max(actual.width, actual.height) > MAX_EDGE
              )
                throw new Error("Invalid photo.");
              if (
                info.size +
                  ownerPhotos(input.userId).reduce(
                    (sum, record) => sum + record.photo.byteSize,
                    0,
                  ) >
                MAX_BYTES
              )
                result = { kind: "limit" };
              else if (!current()) result = { kind: "cancelled" };
              else {
                const bytes = await ports.bytes(normalized.uri);
                if (
                  bytes.length !== info.size ||
                  bytes[0] !== 0xff ||
                  bytes[1] !== 0xd8 ||
                  bytes[2] !== 0xff ||
                  bytes.at(-2) !== 0xff ||
                  bytes.at(-1) !== 0xd9
                )
                  throw new Error("Invalid photo.");
                const id = ports.createId();
                if (!safeSegment(id) || records.has(id))
                  throw new Error("Invalid photo.");
                const directory = `${root}${input.userId}/`;
                await ports.ensureDirectory(directory);
                destination = `${directory}${id}.jpg`;
                track(destination);
                await ports.copy(normalized.uri, destination);
                const copied = await ports.stat(destination);
                if (!copied.exists || copied.size !== info.size)
                  throw new Error("Invalid photo.");
                if (!current()) result = { kind: "cancelled" };
                else
                  selected = Object.freeze({
                    id,
                    location: input.location,
                    uri: destination,
                    mimeType: "image/jpeg",
                    byteSize: info.size,
                    ...actual,
                  });
              }
            }
          }
        }
      } catch {
        result = { kind: "invalid" };
      }
      const toRemove = [...transient].filter(
        (uri) => !selected || uri !== destination,
      );
      if (!(await removeAll(toRemove))) {
        if (destination) {
          remember(destination, input.userId);
          await remove(destination);
        }
        return { kind: "cleanup_failed" };
      }
      if (selected && !current()) {
        return (await remove(selected.uri))
          ? { kind: "cancelled" }
          : { kind: "cleanup_failed" };
      }
      if (selected) {
        cleanup.delete(selected.uri);
        records.set(selected.id, {
          owner: input.userId,
          photo: selected,
          current: input.isCurrent,
          generation: captured,
          active: true,
        });
        return { kind: "selected", photo: selected };
      }
      return result;
    };
    const task = queue.then(run, run);
    queue = task;
    const ownedJobs = jobs.get(input.userId) ?? new Set();
    ownedJobs.add(task);
    jobs.set(input.userId, ownedJobs);
    void task.finally(() => {
      ownedJobs.delete(task);
      if (!ownedJobs.size) jobs.delete(input.userId);
    });
    return task;
  };
  return {
    pick,
    recover,
    release: async (photo) => {
      const record = trusted(photo);
      if (!record) return false;
      record.active = false;
      remember(photo.uri, record.owner);
      const removed = await remove(photo.uri);
      if (removed) records.delete(photo.id);
      return removed;
    },
    cleanupForUser: async (owner) => {
      if (!safeSegment(owner)) return false;
      closing.add(owner);
      generations.set(owner, generation(owner) + 1);
      for (const record of records.values())
        if (record.owner === owner) record.active = false;
      try {
        await Promise.all([...(jobs.get(owner) ?? [])]);
        await startup;
        for (const uri of await ports.listFiles(`${root}${owner}/`)) {
          if (!managed(uri) || !uri.startsWith(`${root}${owner}/`))
            return false;
          remember(uri, owner);
        }
        for (const record of records.values())
          if (record.owner === owner) remember(record.photo.uri, owner);
        const removed = await removeAll(
          [...cleanup]
            .filter(([, value]) => value === owner)
            .map(([uri]) => uri),
        );
        if (removed)
          for (const [id, record] of records)
            if (record.owner === owner) records.delete(id);
        return removed;
      } catch {
        return false;
      } finally {
        closing.delete(owner);
      }
    },
    toUpload: async (photo) => {
      const record = trusted(photo);
      const current = () =>
        record?.active &&
        record.generation === generation(record.owner) &&
        stillCurrent(record.current);
      if (!current()) throw new Error("Reselect this photo.");
      const info = await ports.stat(photo.uri);
      if (!info.exists || info.size !== photo.byteSize || !current())
        throw new Error("Reselect this photo.");
      const blob = await ports.blob(photo.uri);
      if (!current()) throw new Error("Reselect this photo.");
      return { photo: blob, mimeType: "image/jpeg" };
    },
  };
};
