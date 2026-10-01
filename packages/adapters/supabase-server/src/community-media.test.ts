import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { UserId } from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index";
import {
  processCommunityMedia,
  SupabaseCommunityMediaService,
} from "./community-media";
describe("community image derivation", () => {
  it("decodes real JPEG, strips metadata and produces separately bounded JPEGs", async () => {
    const original = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "#889944" },
    })
      .jpeg()
      .withExif({
        IFD0: { Copyright: "private-owner" },
        IFD3: { GPSLatitude: "51/1 0/1 0/1", GPSLongitude: "15/1 0/1 0/1" },
      })
      .toBuffer();
    const result = await processCommunityMedia(original, "image/jpeg");
    const image = await sharp(result.image).metadata();
    const thumbnail = await sharp(result.thumbnail).metadata();
    expect(image.width).toBe(1600);
    expect(image.height).toBe(800);
    expect(image.exif).toBeUndefined();
    expect(image.icc).toBeUndefined();
    expect(image.xmp).toBeUndefined();
    expect(thumbnail.width).toBe(320);
    expect(thumbnail.exif).toBeUndefined();
    expect(result.inputDigest).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects MIME spoof, SVG, truncated image and pixel bomb before storage", async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    await expect(processCommunityMedia(png, "image/jpeg")).rejects.toThrow();
    await expect(
      processCommunityMedia(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>',
        ),
        "image/png",
      ),
    ).rejects.toThrow();
    await expect(
      processCommunityMedia(
        Buffer.from([0xff, 0xd8, 0xff, ...new Array(20).fill(0)]),
        "image/jpeg",
      ),
    ).rejects.toThrow();
    const bomb = await sharp({
      create: { width: 4000, height: 4000, channels: 3, background: "red" },
    })
      .jpeg()
      .toBuffer();
    await expect(processCommunityMedia(bomb, "image/jpeg")).rejects.toThrow();
  });
  it("rejects animated PNG signature even before decode", async () => {
    const bytes = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("acTL"),
      Buffer.alloc(4),
    ]);
    await expect(processCommunityMedia(bytes, "image/png")).rejects.toThrow();
  });
});
describe("authenticated media proxy revocation", () => {
  it("denies decoding and Storage work before authority/quota admission", async () => {
    // This has a JPEG signature but cannot decode. The quota decision must be
    // observed instead of the decoder's invalid_input failure.
    const malformed = Buffer.from([0xff, 0xd8, 0xff, ...new Array(20).fill(0)]);
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: "P0001", message: "community_rate_limited" },
    }));
    const database = { rpc } as unknown as RepositorySupabaseClient;
    const storage = { get: vi.fn(), put: vi.fn(), remove: vi.fn() };
    const service = new SupabaseCommunityMediaService({
      clientFor: () => database,
      serviceClient: database,
      storage,
    });
    await expect(
      service.upload({
        userId: "c1600000-0000-4000-8000-000000000001" as UserId,
        accessToken: "captured",
        operationId: "e1600000-0000-4000-8000-000000000001",
        altText: "Room",
        mimeType: "image/jpeg",
        bytes: malformed,
      }),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(rpc).toHaveBeenCalledOnce();
    expect(storage.put).not.toHaveBeenCalled();
  });
  it("rechecks ACL after bytes arrive and discards them when access was revoked", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { path: "quarantine/known/thumbnail.jpg", version: 2 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "P0001", message: "community_unavailable" },
      });
    const database = { rpc } as unknown as RepositorySupabaseClient;
    const storage = {
      get: vi.fn(async () => new Uint8Array([1, 2])),
      put: vi.fn(),
      remove: vi.fn(),
    };
    const service = new SupabaseCommunityMediaService({
      clientFor: () => database,
      serviceClient: database,
      storage,
    });
    await expect(
      service.content("known", "thumbnail", "captured-token"),
    ).rejects.toThrow();
    expect(storage.get).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("requires matching authorization version after fetch", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { path: "quarantine/known/image.jpg", version: 2 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { path: "quarantine/known/image.jpg", version: 3 },
        error: null,
      });
    const database = { rpc } as unknown as RepositorySupabaseClient;
    const service = new SupabaseCommunityMediaService({
      clientFor: () => database,
      serviceClient: database,
      storage: {
        get: async () => new Uint8Array([1]),
        put: async () => {},
        remove: async () => {},
      },
    });
    await expect(
      service.content("known", "image", "captured-token"),
    ).rejects.toThrow();
  });
  it("retains durable cleanup ticket when Storage deletion fails", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ id: "known", imagePath: "image", thumbnailPath: "thumb" }],
      error: null,
    }));
    const database = { rpc } as unknown as RepositorySupabaseClient;
    const service = new SupabaseCommunityMediaService({
      clientFor: () => database,
      serviceClient: database,
      storage: {
        get: async () => new Uint8Array(),
        put: async () => {},
        remove: async () => {
          throw new Error("storage down");
        },
      },
    });
    await expect(service.cleanup()).rejects.toThrow("storage down");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("community_media_cleanup", {
      p_operation: "claim",
      p_args: { limit: 50 },
    });
  });
});
