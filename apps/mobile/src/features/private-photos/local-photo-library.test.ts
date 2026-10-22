import { beforeEach, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  download: vi.fn(),
  failMove: false,
}));
vi.mock("expo-file-system", () => {
  const join = (parts: any[]) =>
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
      fs.download(url, destination);
    uri: string;
    constructor(...parts: any[]) {
      this.uri = join(parts);
    }
    get name() {
      return this.uri.slice(this.uri.lastIndexOf("/") + 1);
    }
    get exists() {
      return fs.files.has(this.uri);
    }
    get size() {
      return fs.files.get(this.uri)?.length ?? 0;
    }
    async copy(destination: File) {
      if (!this.exists) throw new Error("Missing");
      fs.files.set(destination.uri, fs.files.get(this.uri)!);
    }
    moveSync(destination: File) {
      if (fs.failMove) throw new Error("Move failed");
      fs.files.set(destination.uri, fs.files.get(this.uri)!);
      fs.files.delete(this.uri);
    }
    write(content: string) {
      fs.files.set(this.uri, content);
    }
    textSync() {
      return fs.files.get(this.uri) ?? "";
    }
    delete() {
      fs.files.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = join(parts);
    }
    get exists() {
      return [...fs.files.keys()].some((key) => key.startsWith(`${this.uri}/`));
    }
    create() {}
    list() {
      const prefix = `${this.uri}/`;
      return [...fs.files.keys()]
        .filter((key) => key.startsWith(prefix))
        .filter((key) => !key.slice(prefix.length).includes("/"))
        .map((key) => new File(key));
    }
    delete() {
      for (const key of [...fs.files.keys()])
        if (key.startsWith(`${this.uri}/`)) fs.files.delete(key);
    }
  }
  return { File, Directory, Paths: { document: { uri: "file:///docs" } } };
});

import {
  clearLocalPhotos,
  downloadLocalPhoto,
  listLocalPhotos,
  localPhotoRecord,
  localPhotoUri,
  markLocalPhotoOrphaned,
  recordLocalPhotoBackup,
  removeLocalPhoto,
  resetLocalPhotoLibraryForTests,
  saveLocalPhoto,
} from "./local-photo-library";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEAL = "11111111-1111-4111-8111-111111111111";
const ASSET = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  fs.files.clear();
  fs.download.mockReset();
  fs.failMove = false;
  resetLocalPhotoLibraryForTests();
  fs.files.set("file:///cache/source.jpg", "jpeg-bytes");
});

it("saves a device copy per account and reports it only to that account", async () => {
  const uri = await saveLocalPhoto(
    A,
    "meal",
    MEAL,
    "file:///cache/source.jpg",
    {
      maxBytes: 1024,
    },
  );
  expect(uri).toBe(`file:///docs/private-photos/${A}/meal/${MEAL}.jpg`);
  expect(localPhotoUri(A, "meal", MEAL)).toBe(uri);
  expect(localPhotoUri(B, "meal", MEAL)).toBeNull();
  expect(localPhotoUri(A, "boulder", MEAL)).toBeNull();
  expect(localPhotoRecord(A, "meal", MEAL)).toEqual({
    kind: "meal",
    key: MEAL,
    assetId: null,
  });
});

it("rejects keys that could escape the account folder", async () => {
  await expect(
    saveLocalPhoto(A, "meal", "../other", "file:///cache/source.jpg", {
      maxBytes: 1024,
    }),
  ).rejects.toThrow("Invalid local photo key.");
  expect(localPhotoUri(A, "meal", "../other")).toBeNull();
});

it("refuses oversized files and leaves no partial copy", async () => {
  expect(
    await saveLocalPhoto(A, "meal", MEAL, "file:///cache/source.jpg", {
      maxBytes: 4,
    }),
  ).toBeNull();
  expect(localPhotoUri(A, "meal", MEAL)).toBeNull();
  expect([...fs.files.keys()].some((key) => key.endsWith(".part"))).toBe(false);
});

it("records backups durably and lists device-only photos", async () => {
  await saveLocalPhoto(A, "meal", MEAL, "file:///cache/source.jpg", {
    maxBytes: 1024,
  });
  await saveLocalPhoto(A, "boulder", ASSET, "file:///cache/source.jpg", {
    maxBytes: 1024,
  });
  expect(recordLocalPhotoBackup(A, "meal", MEAL, ASSET)).toBe(true);
  // A fresh process reads the index file again.
  resetLocalPhotoLibraryForTests();
  expect(listLocalPhotos(A)).toEqual(
    expect.arrayContaining([
      { kind: "meal", key: MEAL, assetId: ASSET },
      { kind: "boulder", key: ASSET, assetId: null },
    ]),
  );
});

it("downloads a backup into the library with its asset id", async () => {
  fs.download.mockImplementation(async (_url: string, destination: any) => {
    fs.files.set(destination.uri, "remote");
    return destination;
  });
  const uri = await downloadLocalPhoto(A, "meal", MEAL, "https://signed", {
    assetId: ASSET,
    maxBytes: 1024,
  });
  expect(uri).not.toBeNull();
  expect(localPhotoRecord(A, "meal", MEAL)?.assetId).toBe(ASSET);
});

it("removes one photo, and clears every photo after account deletion", async () => {
  await saveLocalPhoto(A, "meal", MEAL, "file:///cache/source.jpg", {
    maxBytes: 1024,
  });
  await saveLocalPhoto(B, "meal", MEAL, "file:///cache/source.jpg", {
    maxBytes: 1024,
  });
  expect(removeLocalPhoto(A, "meal", MEAL)).toBe(true);
  expect(localPhotoUri(A, "meal", MEAL)).toBeNull();
  await saveLocalPhoto(A, "meal", MEAL, "file:///cache/source.jpg", {
    maxBytes: 1024,
  });
  expect(clearLocalPhotos(A)).toBe(true);
  expect(localPhotoUri(A, "meal", MEAL)).toBeNull();
  expect(listLocalPhotos(A)).toEqual([]);
  // Late writes for a deleted account are refused; other accounts keep theirs.
  expect(
    await saveLocalPhoto(A, "meal", MEAL, "file:///cache/source.jpg", {
      maxBytes: 1024,
    }),
  ).toBeNull();
  expect(localPhotoUri(B, "meal", MEAL)).not.toBeNull();
});

it("treats an unreadable index as unknown backup state instead of device-only", async () => {
  await saveLocalPhoto(A, "meal", MEAL, "file:///cache/source.jpg", {
    maxBytes: 1024,
  });
  recordLocalPhotoBackup(A, "meal", MEAL, ASSET);
  fs.files.set(`file:///docs/private-photos/${A}/index.json`, "{corrupt");
  resetLocalPhotoLibraryForTests();
  // Nothing is offered for backup, and the corrupt index is not overwritten.
  expect(listLocalPhotos(A)).toEqual([]);
  expect(recordLocalPhotoBackup(A, "boulder", ASSET, null)).toBe(false);
  expect(fs.files.get(`file:///docs/private-photos/${A}/index.json`)).toBe(
    "{corrupt",
  );
  // The photo itself still shows and can still be removed.
  expect(localPhotoUri(A, "meal", MEAL)).not.toBeNull();
  expect(removeLocalPhoto(A, "meal", MEAL)).toBe(true);
  expect(localPhotoUri(A, "meal", MEAL)).toBeNull();
});

it("marks a photo orphaned until a new backup is recorded", async () => {
  await saveLocalPhoto(A, "boulder", MEAL, "file:///cache/source.jpg", {
    maxBytes: 1024,
  });
  expect(markLocalPhotoOrphaned(A, "boulder", MEAL)).toBe(true);
  resetLocalPhotoLibraryForTests();
  expect(listLocalPhotos(A)).toEqual([
    { kind: "boulder", key: MEAL, assetId: null, orphaned: true },
  ]);
  recordLocalPhotoBackup(A, "boulder", MEAL, ASSET);
  expect(listLocalPhotos(A)).toEqual([
    { kind: "boulder", key: MEAL, assetId: ASSET },
  ]);
});
