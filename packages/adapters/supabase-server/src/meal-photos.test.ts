import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import type { RepositorySupabaseClient } from "./index";
import type { UserId } from "@mizyun/core";
import { MealPhotoError } from "@mizyun/core";
import { processMealPhoto, SupabaseMealPhotoService } from "./meal-photos";
const userId = "00000000-0000-4000-8000-000000000001" as UserId;
const jpeg = () =>
  sharp({ create: { width: 640, height: 320, channels: 3, background: "red" } })
    .jpeg()
    .withExif({ IFD0: { Copyright: "sensitive-owner" } })
    .toBuffer();
describe("private meal JPEG", () => {
  it("decodes genuine JPEG and strips metadata", async () => {
    const original = await jpeg();
    const out = await processMealPhoto(original, 640, 320);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(320);
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(out.bytes.length).toBeLessThanOrEqual(256 * 1024);
  });
  it("rejects spoofed, truncated, oversized and mismatched decoded input", async () => {
    await expect(
      processMealPhoto(Buffer.from([255, 216, 255, 217]), 640, 320),
    ).rejects.toMatchObject({ kind: "invalid_input" });
    await expect(
      processMealPhoto(new Uint8Array(256 * 1024 + 1), 1, 1),
    ).rejects.toMatchObject({ kind: "invalid_input" });
    await expect(
      processMealPhoto(await jpeg(), 100, 100),
    ).rejects.toMatchObject({ kind: "invalid_input" });
    const png = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    await expect(processMealPhoto(png, 10, 10)).rejects.toMatchObject({
      kind: "invalid_input",
    });
  });
});
describe("meal photo retry boundary", () => {
  const make = () => {
    const row = {
      assetId: "asset-1",
      width: 640,
      height: 320,
      state: "uploading",
      objectPath: "owner/meal-photos/asset-1.jpg",
    };
    const rpc = vi.fn().mockResolvedValue({ data: row, error: null });
    const storage = {
      upload: vi.fn().mockResolvedValue(undefined),
      sign: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const service = new SupabaseMealPhotoService({
      clientFor: () => ({ rpc }) as unknown as RepositorySupabaseClient,
      serviceClient: { rpc } as unknown as RepositorySupabaseClient,
      storage,
    });
    return { row, rpc, storage, service };
  };
  const input = async () => ({
    mealId: "meal",
    userId,
    accessToken: "owner-token",
    clientOperationId: "operation",
    bytes: await jpeg(),
    width: 640,
    height: 320,
  });
  it("uses captured owner for privileged mutation and retries an uncertain commit without creating another photo", async () => {
    const { service, rpc, storage, row } = make();
    rpc
      .mockResolvedValueOnce({ data: row, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "network lost response" },
      })
      .mockResolvedValueOnce({ data: { ...row, state: "ready" }, error: null });
    const body = await input();
    await expect(service.save(body)).rejects.toThrow("network lost response");
    await expect(service.save(body)).resolves.toEqual({
      assetId: "asset-1",
      width: 640,
      height: 320,
    });
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_user_id: userId,
      p_operation: "begin",
    });
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it("removes uploaded bytes when deletion wins before commit", async () => {
    const { service, rpc, storage, row } = make();
    rpc
      .mockResolvedValueOnce({ data: row, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "meal_photo_not_found" },
      });
    await expect(service.save(await input())).rejects.toBeInstanceOf(
      MealPhotoError,
    );
    expect(storage.remove).toHaveBeenCalledWith(row.objectPath);
  });
  it("commits revocation even when storage cleanup must retry", async () => {
    const { service, rpc } = make();
    vi.spyOn(service, "cleanup").mockRejectedValue(
      new Error("storage unavailable"),
    );
    await expect(
      service.remove("meal", { userId, accessToken: "owner-token" }),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith(
      "meal_photo",
      expect.objectContaining({ p_operation: "remove", p_user_id: userId }),
    );
    expect(service.cleanup).toHaveBeenCalledWith(userId);
  });
  it("cleans other queued objects while retaining a failed object's retry", async () => {
    const removedJobs: string[] = [];
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValueOnce(undefined);
    const client = {
      rpc: vi.fn().mockResolvedValue({ error: null }),
      from: () => ({
        select: () => ({
          order: () => ({
            limit: async () => ({
              data: [{ object_path: "failed" }, { object_path: "healthy" }],
              error: null,
            }),
          }),
        }),
        delete: () => ({
          eq: async (_key: string, path: string) => {
            removedJobs.push(path);
            return { error: null };
          },
        }),
      }),
    };
    const service = new SupabaseMealPhotoService({
      clientFor: () => client as unknown as RepositorySupabaseClient,
      serviceClient: client as unknown as RepositorySupabaseClient,
      storage: { upload: vi.fn(), sign: vi.fn(), remove },
    });
    await expect(service.cleanup()).rejects.toThrow("cleanup incomplete");
    expect(remove).toHaveBeenCalledTimes(2);
    expect(removedJobs).toEqual(["healthy"]);
  });
  it("retains cleanup jobs when byte deletion fails", async () => {
    const deleted = vi.fn();
    const remove = vi.fn().mockRejectedValue(new Error("storage unavailable"));
    const client = {
      rpc: vi.fn().mockResolvedValue({ error: null }),
      from: () => ({
        select: () => ({
          order: () => ({
            limit: async () => ({
              data: [{ object_path: "private" }],
              error: null,
            }),
          }),
        }),
        delete: deleted,
      }),
    };
    const service = new SupabaseMealPhotoService({
      clientFor: () => client as unknown as RepositorySupabaseClient,
      serviceClient: client as unknown as RepositorySupabaseClient,
      storage: { upload: vi.fn(), sign: vi.fn(), remove },
    });
    await expect(service.cleanup()).rejects.toThrow("cleanup incomplete");
    expect(deleted).not.toHaveBeenCalled();
  });
});
