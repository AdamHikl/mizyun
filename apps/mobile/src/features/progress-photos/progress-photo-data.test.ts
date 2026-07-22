import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@mizyun/api-client";
import { err, ok, type UserId } from "@mizyun/core";

import {
  uploadProgressPhoto,
  validatePreparedPhoto,
  type PreparedProgressPhoto,
} from "./progress-photo-data";

const principal = {
  userId: "00000000-0000-4000-8000-000000000001" as UserId,
  accessToken: "token",
};

const photo: PreparedProgressPhoto = {
  uri: "file:///photo.jpg",
  mimeType: "image/jpeg",
  byteSize: 4,
  width: 1000,
  height: 1500,
  capturedAt: "2026-07-21T08:00:00.000Z",
};

const configuredClient = (request: ApiClient["request"]): ApiClient => ({
  request,
  status: () => ({ configured: true, baseUrl: "https://api.test" }),
});

describe("validatePreparedPhoto", () => {
  it("accepts a bounded normalized JPEG", () => {
    expect(validatePreparedPhoto(photo)).toBeNull();
  });

  it("rejects an oversized photo", () => {
    expect(
      validatePreparedPhoto({ ...photo, byteSize: 16 * 1024 * 1024 }),
    ).toMatchObject({ kind: "invalid_photo" });
  });
});

describe("uploadProgressPhoto", () => {
  it("requests a ticket and PUTs the normalized bytes", async () => {
    const request = vi.fn().mockResolvedValue(
      ok({
        assetId: "00000000-0000-4000-8000-00000000a001",
        objectPath: `${principal.userId}/a.jpg`,
        uploadUrl: "https://storage.test/upload?token=one-time",
        expiresAt: "2026-07-21T10:00:00.000Z",
      }),
    );
    const uploadFile = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const result = await uploadProgressPhoto(
      configuredClient(request),
      principal,
      photo,
      uploadFile,
    );

    expect(result.ok).toBe(true);
    expect(uploadFile).toHaveBeenCalledWith(
      "https://storage.test/upload?token=one-time",
      photo,
    );
  });

  it("deletes pending metadata when the byte transfer fails", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          assetId: "00000000-0000-4000-8000-00000000a001",
          objectPath: `${principal.userId}/a.jpg`,
          uploadUrl: "https://storage.test/upload?token=one-time",
          expiresAt: "2026-07-21T10:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(ok(undefined));
    const uploadFile = vi.fn().mockRejectedValue(new Error("offline"));

    const result = await uploadProgressPhoto(
      configuredClient(request),
      principal,
      photo,
      uploadFile,
    );

    expect(result).toEqual(err({ kind: "upload_error", message: "offline" }));
    expect(request).toHaveBeenLastCalledWith({
      method: "DELETE",
      path: "/v1/media/00000000-0000-4000-8000-00000000a001",
    });
  });
});
