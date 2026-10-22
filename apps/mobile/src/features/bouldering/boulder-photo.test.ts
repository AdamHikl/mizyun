import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import type { BoulderAscentRecord } from "@mizyun/contracts";

/** In-memory device library: `${owner}:${key}` → { uri, assetId }. */
const library = vi.hoisted(() => ({
  photos: new Map<string, { uri: string; assetId: string | null }>(),
  failSave: false,
  backup: false,
  downloads: [] as string[],
  orphaned: [] as string[],
  downloadGate: null as Promise<void> | null,
}));
vi.mock("@/features/private-photos/local-photo-library", () => {
  const id = (owner: string, key: string) => `${owner}:${key}`;
  const uriFor = (owner: string, key: string) =>
    `file:///private-photos/${owner}/boulder/${key}.jpg`;
  return {
    saveLocalPhoto: vi.fn(
      async (
        owner: string,
        _kind: string,
        key: string,
        _source: string,
        options: { assetId?: string | null },
      ) => {
        if (library.failSave) return null;
        library.photos.set(id(owner, key), {
          uri: uriFor(owner, key),
          assetId: options.assetId ?? null,
        });
        return uriFor(owner, key);
      },
    ),
    downloadLocalPhoto: vi.fn(
      async (
        owner: string,
        _kind: string,
        key: string,
        url: string,
        options: { assetId: string },
      ) => {
        library.downloads.push(url);
        if (library.downloadGate) await library.downloadGate;
        library.photos.set(id(owner, key), {
          uri: uriFor(owner, key),
          assetId: options.assetId,
        });
        return uriFor(owner, key);
      },
    ),
    localPhotoUri: (owner: string, _kind: string, key: string) =>
      library.photos.get(id(owner, key))?.uri ?? null,
    localPhotoRecord: (owner: string, kind: string, key: string) => {
      const photo = library.photos.get(id(owner, key));
      return photo ? { kind, key, assetId: photo.assetId } : null;
    },
    recordLocalPhotoBackup: vi.fn(
      (owner: string, _kind: string, key: string, assetId: string | null) => {
        const photo = library.photos.get(id(owner, key));
        if (photo) photo.assetId = assetId;
        return true;
      },
    ),
    markLocalPhotoOrphaned: vi.fn(
      (owner: string, _kind: string, key: string) => {
        library.orphaned.push(id(owner, key));
        return true;
      },
    ),
    removeLocalPhoto: vi.fn((owner: string, _kind: string, key: string) => {
      library.photos.delete(id(owner, key));
      return true;
    }),
  };
});
vi.mock("@/features/private-photos/photo-backup-preference", () => ({
  loadPhotoBackupEnabled: async () => library.backup,
}));

import {
  attachBoulderPhoto,
  backUpDeviceBoulderPhoto,
  ensureBoulderPhotoOnDevice,
  removeBoulderPhotoBackup,
  uploadBoulderPhoto,
} from "./boulder-photo";
import {
  boulderPhotoSource,
  downloadBoulderBackup,
  forgetBoulderPhoto,
  keepBoulderBackupOnDevice,
  needsSignedBoulderPhoto,
  reconcileBoulderBackupRecord,
  resetBoulderPhotoDisplayForTests,
} from "./boulder-photo-display";
import {
  createBoulderPendingStore,
  type BoulderPendingStore,
} from "./pending-ascents";

const ASSET = "55555555-5555-4555-8555-555555555555";
const OLD_ASSET = "66666666-6666-4666-8666-666666666666";
const OP = "77777777-7777-4777-8777-777777777777";

const photo = {
  uri: "file:///boulder.jpg",
  mimeType: "image/jpeg" as const,
  byteSize: 2048,
  width: 2048,
  height: 1536,
};

const ascent: BoulderAscentRecord = {
  id: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
  sequence: 1,
  gradeScale: "font",
  grade: "6B+",
  gradeRank: 8,
  result: "sent",
  attempts: 4,
  holdColour: "green",
  note: null,
  photoAssetId: OLD_ASSET,
  projectId: null,
  loggedAt: "2026-10-16T10:00:00.000Z",
  revision: 3,
  createdAt: "2026-10-16T10:00:00.000Z",
  updatedAt: "2026-10-16T10:00:00.000Z",
};

const memoryBackend = () => {
  const map = new Map<string, string>();
  return {
    map,
    getItemAsync: async (k: string) => map.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => {
      map.set(k, v);
    },
    deleteItemAsync: async (k: string) => {
      map.delete(k);
    },
  };
};

const mediaClient = (
  failures: {
    linkFails?: boolean;
    linkGone?: boolean;
    unlinkFails?: boolean;
  } = {},
) => {
  const request = vi.fn(async (options: any) => {
    if (options.path === `/v1/bouldering/ascents/${ascent.id}/photo`) {
      if (options.method === "PUT")
        return failures.linkGone
          ? {
              ok: false,
              error: { kind: "http_error", status: 404, code: "NOT_FOUND" },
            }
          : failures.linkFails
            ? { ok: false, error: { kind: "network_error", cause: null } }
            : {
                ok: true,
                value: {
                  ascent: { ...ascent, photoAssetId: options.body.assetId },
                },
              };
      return failures.unlinkFails
        ? { ok: false, error: { kind: "network", message: "offline" } }
        : { ok: true, value: undefined };
    }
    if (options.path === "/v1/media/sign")
      return {
        ok: true,
        value: { signedUrl: `https://signed/${options.body.assetId}` },
      };
    if (options.path === "/v1/media/upload-url")
      return {
        ok: true,
        value: {
          assetId: ASSET,
          uploadUrl: "https://storage.example/upload",
          objectPath: "u/a.jpg",
          expiresAt: "2026-10-16T11:00:00.000Z",
        },
      };
    return { ok: true, value: undefined };
  });
  return {
    request,
    client: {
      status: () => ({ configured: true, baseUrl: "https://example.test" }),
      request,
    } as unknown as ApiClient,
  };
};

beforeEach(() => {
  library.photos.clear();
  library.failSave = false;
  library.backup = false;
  library.downloads = [];
  library.orphaned = [];
  library.downloadGate = null;
  resetBoulderPhotoDisplayForTests();
});

describe("boulder photos", () => {
  it("requests a private `workout` upload ticket for the re-encoded JPEG", async () => {
    const { client, request } = mediaClient();
    const result = await uploadBoulderPhoto(client, photo, async () => ({
      ok: true,
      status: 200,
    }));
    expect(result).toEqual({ ok: true, assetId: ASSET });
    expect(request.mock.calls[0]![0].body).toEqual({
      purpose: "workout",
      mimeType: "image/jpeg",
      byteSize: 2048,
      width: 2048,
      height: 1536,
    });
  });

  it("backup off: keeps the photo on the device and never asks for an upload ticket", async () => {
    const { client, request } = mediaClient();
    const store = createBoulderPendingStore(memoryBackend());
    const fresh = { ...ascent, photoAssetId: null };
    const outcome = await attachBoulderPhoto({
      userId: "photo-user-off",
      client,
      ascent: fresh,
      photo,
      operationId: OP,
      isCurrent: () => true,
      store,
    });
    expect(outcome).toEqual({ kind: "kept_on_device", backupPending: false });
    expect(request).not.toHaveBeenCalled();
    expect((await store.load("photo-user-off")).commands).toEqual([]);
    expect(library.photos.get(`photo-user-off:${ascent.id}`)).toMatchObject({
      assetId: null,
    });
  });

  it("backup off: a new device photo unlinks the older server backup durably", async () => {
    const { client, request } = mediaClient();
    const store = createBoulderPendingStore(memoryBackend());
    const outcome = await attachBoulderPhoto({
      userId: "photo-user-replace",
      client,
      ascent,
      photo,
      operationId: OP,
      isCurrent: () => true,
      store,
    });
    expect(outcome.kind).toBe("kept_on_device");
    expect(request).not.toHaveBeenCalled();
    const [command] = (await store.load("photo-user-replace")).commands;
    expect(command).toMatchObject({
      kind: "update",
      replacedPhotoAssetId: OLD_ASSET,
      body: { photoAssetId: null, clientOperationId: OP },
    });
    // Until the unlink syncs, the row (still naming the old asset) shows the device copy.
    expect(
      boulderPhotoSource("photo-user-replace", ascent.id, OLD_ASSET, {}),
    ).toEqual({
      uri: expect.stringContaining(ascent.id),
      cachePolicy: "none",
    });
  });

  it("backup off: a device save failure is reported so the screen offers Retry photo", async () => {
    library.failSave = true;
    const { client, request } = mediaClient();
    const outcome = await attachBoulderPhoto({
      userId: "photo-user-nosave",
      client,
      ascent,
      photo,
      operationId: OP,
      isCurrent: () => true,
      store: createBoulderPendingStore(memoryBackend()),
    });
    expect(outcome.kind).toBe("not_saved");
    expect(request).not.toHaveBeenCalled();
  });

  it("backup on: an upload failure keeps the device copy without Retry and cleans up the ticket", async () => {
    library.backup = true;
    const { client, request } = mediaClient();
    const store = createBoulderPendingStore(memoryBackend());
    const outcome = await attachBoulderPhoto({
      userId: "photo-user-a",
      client,
      ascent: { ...ascent, photoAssetId: null },
      photo,
      operationId: OP,
      isCurrent: () => true,
      store,
      uploadFile: async () => ({ ok: false, status: 500 }),
    });
    expect(outcome).toEqual({ kind: "kept_on_device", backupPending: true });
    // No edit was queued, so the saved boulder keeps its current data.
    expect((await store.load("photo-user-a")).commands).toEqual([]);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: `/v1/media/${ASSET}` }),
    );
    expect(library.photos.get(`photo-user-a:${ascent.id}`)).toMatchObject({
      assetId: null,
    });
  });

  it("backup on: upload and device save both failing offers Retry photo", async () => {
    library.backup = true;
    library.failSave = true;
    const { client } = mediaClient();
    const outcome = await attachBoulderPhoto({
      userId: "photo-user-both",
      client,
      ascent,
      photo,
      operationId: OP,
      isCurrent: () => true,
      store: createBoulderPendingStore(memoryBackend()),
      uploadFile: async () => ({ ok: false, status: 500 }),
    });
    expect(outcome.kind).toBe("upload_failed");
  });

  it("backup on: uploads, queues a durable edit linking the photo and records the backup", async () => {
    library.backup = true;
    const { client } = mediaClient();
    const store = createBoulderPendingStore(memoryBackend());
    const outcome = await attachBoulderPhoto({
      userId: "photo-user-b",
      client,
      ascent,
      photo,
      operationId: OP,
      isCurrent: () => true,
      store,
      uploadFile: async () => ({ ok: true, status: 200 }),
    });
    expect(outcome.kind).toBe("queued");
    const [command] = (await store.load("photo-user-b")).commands;
    expect(command).toMatchObject({
      kind: "update",
      ascentId: ascent.id,
      replacedPhotoAssetId: OLD_ASSET,
      body: {
        clientOperationId: OP,
        expectedRevision: 3,
        grade: "6B+",
        result: "sent",
        attempts: 4,
        holdColour: "green",
        photoAssetId: ASSET,
      },
    });
    expect(library.photos.get(`photo-user-b:${ascent.id}`)).toMatchObject({
      assetId: ASSET,
    });
  });

  it("backup on: deletes the uploaded asset if the edit can't be kept, keeping the device copy", async () => {
    library.backup = true;
    const { client, request } = mediaClient();
    const failing: BoulderPendingStore = {
      ...createBoulderPendingStore(memoryBackend()),
      enqueue: async () => ({ ok: false, reason: "storage" }),
    };
    const outcome = await attachBoulderPhoto({
      userId: "photo-user-c",
      client,
      ascent: { ...ascent, photoAssetId: null },
      photo,
      operationId: OP,
      isCurrent: () => true,
      store: failing,
      uploadFile: async () => ({ ok: true, status: 200 }),
    });
    expect(outcome.kind).toBe("kept_on_device");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: `/v1/media/${ASSET}` }),
    );
    expect(library.photos.has(`photo-user-c:${ascent.id}`)).toBe(true);
  });

  it("removes the new device copy when an older backup can't be unlinked", async () => {
    const failing: BoulderPendingStore = {
      ...createBoulderPendingStore(memoryBackend()),
      enqueue: async () => ({ ok: false, reason: "storage" }),
    };
    const outcome = await attachBoulderPhoto({
      userId: "photo-user-d",
      client: mediaClient().client,
      ascent,
      photo,
      operationId: OP,
      isCurrent: () => true,
      store: failing,
    });
    expect(outcome.kind).toBe("not_saved");
    expect(library.photos.has(`photo-user-d:${ascent.id}`)).toBe(false);
  });

  describe("display", () => {
    it("prefers the matching device copy and never signs it", () => {
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: OLD_ASSET,
      });
      expect(needsSignedBoulderPhoto("owner-a", ascent.id, OLD_ASSET)).toBe(
        false,
      );
      expect(
        boulderPhotoSource("owner-a", ascent.id, OLD_ASSET, {
          [OLD_ASSET]: "https://signed",
        }),
      ).toEqual({ uri: "file:///a.jpg", cachePolicy: "none" });
    });

    it("shows a device-only photo for an ascent without a server photo", () => {
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: null,
      });
      expect(boulderPhotoSource("owner-a", ascent.id, null, {})).toEqual({
        uri: "file:///a.jpg",
        cachePolicy: "none",
      });
    });

    it("signs and downloads a server photo with no matching device copy", async () => {
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///stale.jpg",
        assetId: OLD_ASSET,
      });
      expect(needsSignedBoulderPhoto("owner-a", ascent.id, ASSET)).toBe(true);
      expect(
        boulderPhotoSource("owner-a", ascent.id, ASSET, {
          [ASSET]: "https://signed",
        }),
      ).toEqual({ uri: "https://signed", cachePolicy: "memory" });
      keepBoulderBackupOnDevice("owner-a", ascent.id, ASSET, "https://signed");
      await Promise.resolve();
      expect(library.downloads).toEqual(["https://signed"]);
      expect(boulderPhotoSource("owner-a", ascent.id, ASSET, {})).toEqual({
        uri: expect.stringContaining(ascent.id),
        cachePolicy: "none",
      });
    });

    it("deleting a boulder removes only that account's device copy", () => {
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: OLD_ASSET,
      });
      library.photos.set(`owner-b:${ascent.id}`, {
        uri: "file:///b.jpg",
        assetId: null,
      });
      expect(forgetBoulderPhoto("owner-a", ascent.id)).toBe(true);
      expect(library.photos.has(`owner-a:${ascent.id}`)).toBe(false);
      expect(library.photos.has(`owner-b:${ascent.id}`)).toBe(true);
      expect(boulderPhotoSource("owner-a", ascent.id, null, {})).toBeNull();
    });

    it("never shows another account's device copy", () => {
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: null,
      });
      expect(boulderPhotoSource("owner-b", ascent.id, null, {})).toBeNull();
      expect(boulderPhotoSource("", ascent.id, null, {})).toBeNull();
    });
  });

  describe("background backup", () => {
    const measure = async () => ({ byteSize: 2048, width: 2048, height: 1536 });

    it("uploads a device-only photo, links it and records the backup", async () => {
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: null,
      });
      const { client, request } = mediaClient();
      const ok = await backUpDeviceBoulderPhoto({
        userId: "owner-a",
        client,
        ascentId: ascent.id,
        isCurrent: () => true,
        uploadFile: async () => ({ ok: true, status: 200 }),
        measure,
        store: createBoulderPendingStore(memoryBackend()),
      });
      expect(ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "PUT",
          path: `/v1/bouldering/ascents/${ascent.id}/photo`,
          body: { assetId: ASSET },
        }),
      );
      expect(library.photos.get(`owner-a:${ascent.id}`)!.assetId).toBe(ASSET);
    });

    it("skips photos that are missing or already backed up", async () => {
      const { client, request } = mediaClient();
      const input = {
        userId: "owner-a",
        client,
        ascentId: ascent.id,
        isCurrent: () => true,
        measure,
        store: createBoulderPendingStore(memoryBackend()),
      };
      expect(await backUpDeviceBoulderPhoto(input)).toBe(false);
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: OLD_ASSET,
      });
      expect(await backUpDeviceBoulderPhoto(input)).toBe(false);
      expect(request).not.toHaveBeenCalled();
    });

    it("deletes the uploaded asset when linking fails", async () => {
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: null,
      });
      const { client, request } = mediaClient({ linkFails: true });
      const ok = await backUpDeviceBoulderPhoto({
        userId: "owner-a",
        client,
        ascentId: ascent.id,
        isCurrent: () => true,
        uploadFile: async () => ({ ok: true, status: 200 }),
        measure,
        store: createBoulderPendingStore(memoryBackend()),
      });
      expect(ok).toBe(false);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "DELETE",
          path: `/v1/media/${ASSET}`,
        }),
      );
      expect(library.photos.get(`owner-a:${ascent.id}`)!.assetId).toBeNull();
    });

    it("fences every backup request to the account and checks it again after measuring", async () => {
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: null,
      });
      const { client, request } = mediaClient();
      let current = true;
      const isCurrent = () => current;
      expect(
        await backUpDeviceBoulderPhoto({
          userId: "owner-a",
          client,
          ascentId: ascent.id,
          isCurrent,
          uploadFile: async () => ({ ok: true, status: 200 }),
          measure,
          store: createBoulderPendingStore(memoryBackend()),
        }),
      ).toBe(true);
      for (const [options] of request.mock.calls) {
        expect(options.expectedUserId).toBe("owner-a");
        expect(options.isCurrent).toBe(isCurrent);
      }
      // An account switch while measuring never asks for an upload ticket.
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: null,
      });
      request.mockClear();
      expect(
        await backUpDeviceBoulderPhoto({
          userId: "owner-a",
          client,
          ascentId: ascent.id,
          isCurrent,
          measure: async () => {
            current = false;
            return measure();
          },
          store: createBoulderPendingStore(memoryBackend()),
        }),
      ).toBe(false);
      expect(request).not.toHaveBeenCalled();
    });

    it("never sends bytes when the account changes after the ticket", async () => {
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: null,
      });
      const { client, request } = mediaClient();
      let current = true;
      request.mockImplementationOnce(async () => {
        current = false;
        return {
          ok: true,
          value: {
            assetId: ASSET,
            uploadUrl: "https://storage.example/upload",
            objectPath: "u/a.jpg",
            expiresAt: "2026-10-16T11:00:00.000Z",
          },
        } as any;
      });
      const uploadFile = vi.fn(async () => ({ ok: true, status: 200 }));
      expect(
        await backUpDeviceBoulderPhoto({
          userId: "owner-a",
          client,
          ascentId: ascent.id,
          isCurrent: () => current,
          uploadFile,
          measure,
          store: createBoulderPendingStore(memoryBackend()),
        }),
      ).toBe(false);
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it("skips a boulder with an edit waiting to sync", async () => {
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: null,
      });
      const store = createBoulderPendingStore(memoryBackend());
      await store.enqueue(
        "owner-a",
        {
          kind: "delete",
          sessionId: ascent.sessionId,
          ascentId: ascent.id,
          operationId: OP,
          photoAssetId: null,
          queuedAt: "2026-10-16T10:00:00.000Z",
        },
        () => true,
      );
      const { client, request } = mediaClient();
      expect(
        await backUpDeviceBoulderPhoto({
          userId: "owner-a",
          client,
          ascentId: ascent.id,
          isCurrent: () => true,
          uploadFile: async () => ({ ok: true, status: 200 }),
          measure,
          store,
        }),
      ).toBe(false);
      expect(request).not.toHaveBeenCalled();
    });

    it("marks the device photo orphaned when the boulder is gone", async () => {
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: null,
      });
      const { client, request } = mediaClient({ linkGone: true });
      expect(
        await backUpDeviceBoulderPhoto({
          userId: "owner-a",
          client,
          ascentId: ascent.id,
          isCurrent: () => true,
          uploadFile: async () => ({ ok: true, status: 200 }),
          measure,
          store: createBoulderPendingStore(memoryBackend()),
        }),
      ).toBe(false);
      expect(library.orphaned).toEqual([`owner-a:${ascent.id}`]);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "DELETE",
          path: `/v1/media/${ASSET}`,
        }),
      );
    });

    it("a network failure while linking is not treated as a removed boulder", async () => {
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: null,
      });
      const { client } = mediaClient({ linkFails: true });
      await backUpDeviceBoulderPhoto({
        userId: "owner-a",
        client,
        ascentId: ascent.id,
        isCurrent: () => true,
        uploadFile: async () => ({ ok: true, status: 200 }),
        measure,
        store: createBoulderPendingStore(memoryBackend()),
      });
      expect(library.orphaned).toEqual([]);
    });

    it("ensures a backup is on the device before it is removed", async () => {
      const { client, request } = mediaClient();
      const input = {
        userId: "owner-a",
        client,
        ascentId: ascent.id,
        assetId: OLD_ASSET,
        isCurrent: () => true,
      };
      expect(await ensureBoulderPhotoOnDevice(input)).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/v1/media/sign",
          expectedUserId: "owner-a",
        }),
      );
      expect(library.downloads).toEqual([`https://signed/${OLD_ASSET}`]);
      // Already matching: no network.
      request.mockClear();
      expect(await ensureBoulderPhotoOnDevice(input)).toBe(true);
      expect(request).not.toHaveBeenCalled();
    });

    it("never downloads a backup over a newer device photo", async () => {
      library.backup = false;
      await attachBoulderPhoto({
        userId: "owner-a",
        client: mediaClient().client,
        ascent,
        photo,
        operationId: OP,
        isCurrent: () => true,
        store: createBoulderPendingStore(memoryBackend()),
      });
      const { client, request } = mediaClient();
      expect(
        await ensureBoulderPhotoOnDevice({
          userId: "owner-a",
          client,
          ascentId: ascent.id,
          assetId: OLD_ASSET,
          isCurrent: () => true,
        }),
      ).toBe(false);
      expect(request).not.toHaveBeenCalled();
      expect(library.photos.get(`owner-a:${ascent.id}`)!.assetId).toBeNull();
    });

    it("clears a stale backup record when a synced edit has no server photo", () => {
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: OLD_ASSET,
      });
      const synced = { ...ascent, photoAssetId: null };
      expect(reconcileBoulderBackupRecord("owner-a", synced, true)).toBe(false);
      expect(library.photos.get(`owner-a:${ascent.id}`)!.assetId).toBe(
        OLD_ASSET,
      );
      expect(reconcileBoulderBackupRecord("owner-a", synced, false)).toBe(true);
      expect(library.photos.get(`owner-a:${ascent.id}`)!.assetId).toBeNull();
    });

    it("still deletes the uploaded asset when isCurrent turns false after the upload", async () => {
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: null,
      });
      const { client, request } = mediaClient();
      let current = true;
      expect(
        await backUpDeviceBoulderPhoto({
          userId: "owner-a",
          client,
          ascentId: ascent.id,
          isCurrent: () => current,
          uploadFile: async () => {
            current = false;
            return { ok: true, status: 200 };
          },
          measure,
          store: createBoulderPendingStore(memoryBackend()),
        }),
      ).toBe(false);
      const cleanup = request.mock.calls
        .map(([options]) => options)
        .find((options) => options.path === `/v1/media/${ASSET}`);
      expect(cleanup).toMatchObject({
        method: "DELETE",
        expectedUserId: "owner-a",
      });
      expect(cleanup!.isCurrent).toBeUndefined();
      expect(
        request.mock.calls.some(([options]) => options.method === "PUT"),
      ).toBe(false);
    });

    it("attach still deletes its uploaded asset when isCurrent turns false after the upload", async () => {
      library.backup = true;
      const { client, request } = mediaClient();
      let current = true;
      const outcome = await attachBoulderPhoto({
        userId: "owner-a",
        client,
        ascent: { ...ascent, photoAssetId: null },
        photo,
        operationId: OP,
        isCurrent: () => current,
        store: createBoulderPendingStore(memoryBackend()),
        uploadFile: async () => {
          current = false;
          return { ok: true, status: 200 };
        },
      });
      expect(outcome.kind).toBe("not_saved");
      const cleanup = request.mock.calls
        .map(([options]) => options)
        .find((options) => options.path === `/v1/media/${ASSET}`);
      expect(cleanup).toMatchObject({
        method: "DELETE",
        expectedUserId: "owner-a",
      });
      expect(cleanup!.isCurrent).toBeUndefined();
    });

    it("a waiting backup download never lands over a photo being attached", async () => {
      let open!: () => void;
      library.downloadGate = new Promise<void>((resolve) => {
        open = resolve;
      });
      // A backup download is running, and a second caller waits on it.
      // (for another asset, so the waiter would otherwise start its own).
      const first = downloadBoulderBackup(
        "owner-a",
        ascent.id,
        ASSET,
        "https://signed/first",
      );
      await Promise.resolve();
      const waiting = downloadBoulderBackup(
        "owner-a",
        ascent.id,
        OLD_ASSET,
        "https://signed/second",
      );
      const attach = attachBoulderPhoto({
        userId: "owner-a",
        client: mediaClient().client,
        ascent,
        photo,
        operationId: OP,
        isCurrent: () => true,
        store: createBoulderPendingStore(memoryBackend()),
      });
      library.downloadGate = null;
      open();
      await Promise.all([first, waiting]);
      expect((await attach).kind).toBe("kept_on_device");
      expect(library.downloads).toEqual(["https://signed/first"]);
      // The new device photo (not yet backed up) is what the device keeps.
      expect(library.photos.get(`owner-a:${ascent.id}`)!.assetId).toBeNull();
      // The old backup isn't downloaded again once the attach finished.
      expect(
        await downloadBoulderBackup(
          "owner-a",
          ascent.id,
          OLD_ASSET,
          "https://signed/third",
        ),
      ).toBe(false);
      expect(library.downloads).toEqual(["https://signed/first"]);
    });

    it("removing a backup clears the link and keeps the device copy", async () => {
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: OLD_ASSET,
      });
      const { client, request } = mediaClient();
      const ok = await removeBoulderPhotoBackup({
        userId: "owner-a",
        client,
        ascentId: ascent.id,
        isCurrent: () => true,
      });
      expect(ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "DELETE",
          path: `/v1/bouldering/ascents/${ascent.id}/photo`,
        }),
      );
      expect(library.photos.get(`owner-a:${ascent.id}`)).toEqual({
        uri: "file:///a.jpg",
        assetId: null,
      });
    });

    it("a failed backup removal keeps the backup record", async () => {
      library.photos.set(`owner-a:${ascent.id}`, {
        uri: "file:///a.jpg",
        assetId: OLD_ASSET,
      });
      const { client } = mediaClient({ unlinkFails: true });
      expect(
        await removeBoulderPhotoBackup({
          userId: "owner-a",
          client,
          ascentId: ascent.id,
          isCurrent: () => true,
        }),
      ).toBe(false);
      expect(library.photos.get(`owner-a:${ascent.id}`)!.assetId).toBe(
        OLD_ASSET,
      );
    });
  });

  it("rejects an empty prepared file before asking for a ticket", async () => {
    const { client, request } = mediaClient();
    const result = await uploadBoulderPhoto(client, { ...photo, byteSize: 0 });
    expect(result.ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});
