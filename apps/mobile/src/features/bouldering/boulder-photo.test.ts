import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import type { BoulderAscentRecord } from "@mizyun/contracts";

import { attachBoulderPhoto, uploadBoulderPhoto } from "./boulder-photo";
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

const mediaClient = () => {
  const request = vi.fn(async (options: any) => {
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

  it("an upload failure keeps the boulder unchanged and cleans up the ticket", async () => {
    const { client, request } = mediaClient();
    const storage = memoryBackend();
    const store = createBoulderPendingStore(storage);
    const outcome = await attachBoulderPhoto({
      userId: "photo-user-a",
      client,
      ascent,
      photo,
      operationId: OP,
      isCurrent: () => true,
      store,
      uploadFile: async () => ({ ok: false, status: 500 }),
    });
    expect(outcome.kind).toBe("upload_failed");
    // No edit was queued, so the saved boulder keeps its current data.
    expect((await store.load("photo-user-a")).commands).toEqual([]);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: `/v1/media/${ASSET}` }),
    );
  });

  it("a successful upload queues a durable edit linking the new photo", async () => {
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
  });

  it("deletes the uploaded asset if the edit can't be kept on the device", async () => {
    const { client, request } = mediaClient();
    const failing: BoulderPendingStore = {
      ...createBoulderPendingStore(memoryBackend()),
      enqueue: async () => ({ ok: false, reason: "storage" }),
    };
    const outcome = await attachBoulderPhoto({
      userId: "photo-user-c",
      client,
      ascent,
      photo,
      operationId: OP,
      isCurrent: () => true,
      store: failing,
      uploadFile: async () => ({ ok: true, status: 200 }),
    });
    expect(outcome.kind).toBe("not_saved");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: `/v1/media/${ASSET}` }),
    );
  });

  it("rejects an empty prepared file before asking for a ticket", async () => {
    const { client, request } = mediaClient();
    const result = await uploadBoulderPhoto(client, { ...photo, byteSize: 0 });
    expect(result.ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});
