import { useSyncExternalStore } from "react";
import { Directory, File, Paths } from "expo-file-system";

/**
 * Private photos kept on this device (ADR-0079). Meal and boulder photos live
 * in the app's document directory, one folder per account, and are shown from
 * here first. A small index records which photos also have a server backup.
 * Android Auto Backup never includes these files (the backup rules only cover
 * shared preferences); iOS device backups do.
 */
export type LocalPhotoKind = "meal" | "boulder";
export interface LocalPhotoRecord {
  readonly kind: LocalPhotoKind;
  readonly key: string;
  /** Server media asset id when this photo is also backed up; null when device-only. */
  readonly assetId: string | null;
  /** Its meal or ascent no longer exists on the server, so it is never backed up. */
  readonly orphaned?: boolean;
}

const KINDS: readonly LocalPhotoKind[] = ["meal", "boulder"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isKey = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

const retiredOwners = new Set<string>();
const indexes = new Map<string, Map<string, LocalPhotoRecord>>();
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  for (const listener of listeners) listener();
};

const ownerDirectory = (owner: string) =>
  new Directory(Paths.document, "private-photos", encodeURIComponent(owner));
const kindDirectory = (owner: string, kind: LocalPhotoKind) =>
  new Directory(ownerDirectory(owner), kind);
const photoFile = (owner: string, kind: LocalPhotoKind, key: string) =>
  new File(kindDirectory(owner, kind), `${key}.jpg`);
const indexFile = (owner: string) =>
  new File(ownerDirectory(owner), "index.json");
const recordId = (kind: LocalPhotoKind, key: string) => `${kind}:${key}`;

/**
 * Reads the backup index. Throws when an existing index cannot be read, so
 * callers never overwrite it or treat backed-up photos as device-only.
 */
const readIndex = (owner: string): Map<string, LocalPhotoRecord> => {
  const cached = indexes.get(owner);
  if (cached) return cached;
  const index = new Map<string, LocalPhotoRecord>();
  const file = indexFile(owner);
  if (file.exists) {
    const parsed: unknown = JSON.parse(file.textSync());
    if (!Array.isArray(parsed)) throw new Error("Unreadable photo index.");
    for (const item of parsed) {
      const record = item as Partial<LocalPhotoRecord> | null;
      if (
        record &&
        KINDS.includes(record.kind as LocalPhotoKind) &&
        isKey(record.key) &&
        (record.assetId === null || isKey(record.assetId))
      )
        index.set(recordId(record.kind!, record.key), {
          kind: record.kind!,
          key: record.key,
          assetId: record.assetId,
          ...(record.orphaned === true ? { orphaned: true } : {}),
        });
    }
  }
  indexes.set(owner, index);
  return index;
};

const writeIndex = (owner: string, index: Map<string, LocalPhotoRecord>) => {
  const directory = ownerDirectory(owner);
  directory.create({ intermediates: true, idempotent: true });
  const temporary = new File(directory, "index.json.tmp");
  temporary.write(JSON.stringify([...index.values()]));
  temporary.moveSync(indexFile(owner), { overwrite: true });
};

const checkKey = (kind: LocalPhotoKind, key: string) => {
  if (!KINDS.includes(kind) || !isKey(key))
    throw new Error("Invalid local photo key.");
};

/** File URI of the device copy, or null when this photo is not on the device. */
export const localPhotoUri = (
  owner: string,
  kind: LocalPhotoKind,
  key: string,
): string | null => {
  if (!owner || retiredOwners.has(owner) || !isKey(key)) return null;
  try {
    const file = photoFile(owner, kind, key);
    return file.exists && file.size > 0 ? file.uri : null;
  } catch {
    return null;
  }
};

export const localPhotoRecord = (
  owner: string,
  kind: LocalPhotoKind,
  key: string,
): LocalPhotoRecord | null => {
  if (!localPhotoUri(owner, kind, key)) return null;
  try {
    return (
      readIndex(owner).get(recordId(kind, key)) ?? { kind, key, assetId: null }
    );
  } catch {
    return { kind, key, assetId: null };
  }
};

/** Every photo on the device for this account, with its backup state. */
export const listLocalPhotos = (owner: string): LocalPhotoRecord[] => {
  if (!owner || retiredOwners.has(owner)) return [];
  let index: Map<string, LocalPhotoRecord>;
  try {
    index = readIndex(owner);
  } catch {
    // Without backup state nothing may be uploaded or treated as device-only.
    return [];
  }
  const records: LocalPhotoRecord[] = [];
  for (const kind of KINDS) {
    try {
      const directory = kindDirectory(owner, kind);
      if (!directory.exists) continue;
      for (const entry of directory.list()) {
        const key = entry.name.replace(/\.jpg$/, "");
        if (!(entry instanceof File) || !isKey(key) || entry.size <= 0)
          continue;
        records.push(
          index.get(recordId(kind, key)) ?? { kind, key, assetId: null },
        );
      }
    } catch {
      /* A folder that cannot be listed has nothing to back up or remove. */
    }
  }
  return records;
};

/** Records (or clears, with null) the server backup that matches a device photo. */
export const recordLocalPhotoBackup = (
  owner: string,
  kind: LocalPhotoKind,
  key: string,
  assetId: string | null,
): boolean => {
  checkKey(kind, key);
  if (retiredOwners.has(owner) || (assetId !== null && !isKey(assetId)))
    return false;
  try {
    const index = readIndex(owner);
    const next = new Map(index);
    next.set(recordId(kind, key), { kind, key, assetId });
    writeIndex(owner, next);
    indexes.set(owner, next);
    changed();
    return true;
  } catch {
    return false;
  }
};

/** Stops backing up a photo whose meal or ascent was deleted elsewhere. */
export const markLocalPhotoOrphaned = (
  owner: string,
  kind: LocalPhotoKind,
  key: string,
): boolean => {
  checkKey(kind, key);
  if (retiredOwners.has(owner)) return false;
  try {
    const index = readIndex(owner);
    const next = new Map(index);
    next.set(recordId(kind, key), {
      kind,
      key,
      assetId: null,
      orphaned: true,
    });
    writeIndex(owner, next);
    indexes.set(owner, next);
    return true;
  } catch {
    return false;
  }
};

const replaceWith = async (
  owner: string,
  kind: LocalPhotoKind,
  key: string,
  fill: (temporary: File) => Promise<void>,
  assetId: string | null,
  maxBytes: number,
): Promise<string | null> => {
  checkKey(kind, key);
  if (retiredOwners.has(owner)) return null;
  const directory = kindDirectory(owner, kind);
  // Unique per write, so concurrent saves of one photo never delete each other's file.
  const temporary = new File(
    directory,
    `${key}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.part`,
  );
  try {
    directory.create({ intermediates: true, idempotent: true });
    await fill(temporary);
    if (retiredOwners.has(owner)) throw new Error("Account data was cleared.");
    if (!temporary.exists || temporary.size <= 0 || temporary.size > maxBytes)
      throw new Error("The photo could not be saved on this device.");
    const destination = photoFile(owner, kind, key);
    temporary.moveSync(destination, { overwrite: true });
    recordLocalPhotoBackup(owner, kind, key, assetId);
    return destination.uri;
  } catch {
    try {
      if (temporary.exists) temporary.delete();
    } catch {
      /* Leftover .part files are ignored and replaced next time. */
    }
    return null;
  }
};

/** Copies an app-owned, already re-encoded JPEG into the device library. */
export const saveLocalPhoto = (
  owner: string,
  kind: LocalPhotoKind,
  key: string,
  sourceUri: string,
  options: { readonly assetId?: string | null; readonly maxBytes: number },
): Promise<string | null> =>
  replaceWith(
    owner,
    kind,
    key,
    (temporary) => new File(sourceUri).copy(temporary),
    options.assetId ?? null,
    options.maxBytes,
  );

/** Keeps a server-backed photo on the device so later views need no network. */
export const downloadLocalPhoto = (
  owner: string,
  kind: LocalPhotoKind,
  key: string,
  signedUrl: string,
  options: { readonly assetId: string; readonly maxBytes: number },
): Promise<string | null> =>
  replaceWith(
    owner,
    kind,
    key,
    async (temporary) => {
      await File.downloadFileAsync(signedUrl, temporary, { idempotent: true });
    },
    options.assetId,
    options.maxBytes,
  );

export const removeLocalPhoto = (
  owner: string,
  kind: LocalPhotoKind,
  key: string,
): boolean => {
  if (!owner || !isKey(key)) return false;
  try {
    const file = photoFile(owner, kind, key);
    if (file.exists) file.delete();
  } catch {
    return false;
  }
  try {
    const index = readIndex(owner);
    if (index.has(recordId(kind, key))) {
      const next = new Map(index);
      next.delete(recordId(kind, key));
      writeIndex(owner, next);
      indexes.set(owner, next);
    }
  } catch {
    /* A leftover index entry without its file is ignored. */
  }
  changed();
  return true;
};

/** Called only after account deletion: removes every device photo for the owner. */
export const clearLocalPhotos = (owner: string): boolean => {
  retiredOwners.add(owner);
  indexes.delete(owner);
  try {
    const directory = ownerDirectory(owner);
    if (directory.exists) directory.delete();
    changed();
    return true;
  } catch {
    return false;
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Re-renders when any device photo is saved, removed or re-indexed. */
export const useLocalPhotoVersion = (): number =>
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );

export const useLocalPhotoUri = (
  owner: string | null,
  kind: LocalPhotoKind,
  key: string | null,
): string | null => {
  useLocalPhotoVersion();
  return owner && key ? localPhotoUri(owner, kind, key) : null;
};

/** Test-only reset of module state. */
export const resetLocalPhotoLibraryForTests = () => {
  retiredOwners.clear();
  indexes.clear();
  version = 0;
};
