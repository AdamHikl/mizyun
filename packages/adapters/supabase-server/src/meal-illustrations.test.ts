import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { UserId } from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import {
  processMealIllustration,
  SupabaseMealIllustrationRepository,
} from "./meal-illustrations.js";

describe("trusted illustration image processing", () => {
  it("decodes, strips metadata, and resizes a synthetic provider image", async () => {
    const bytes = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: "#fead50" },
    })
      .png()
      .toBuffer();
    const image = Buffer.from(await processMealIllustration(bytes), "base64");
    const metadata = await sharp(image).metadata();
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(320);
    expect(metadata.format).toBe("jpeg");
    expect(metadata.exif).toBeUndefined();
    expect(image.length).toBeLessThanOrEqual(256 * 1024);
  });
  it("rejects invalid decode, huge byte buffers, and excessive decoded pixels", async () => {
    await expect(
      processMealIllustration(Buffer.from("no image")),
    ).rejects.toThrow();
    await expect(
      processMealIllustration(new Uint8Array(4 * 1024 * 1024 + 1)),
    ).rejects.toThrow();
    const bomb = await sharp({
      create: { width: 4096, height: 4096, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    await expect(processMealIllustration(bomb)).rejects.toThrow();
  });
  it("rejects SVG even when the decoder supports it", async () => {
    await expect(
      processMealIllustration(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
        ),
      ),
    ).rejects.toThrow();
  });
});
describe("illustration database error boundaries", () => {
  function repositoryWithPage(page: {
    data: unknown[];
    error: { code: string; message: string } | null;
  }) {
    const query = {
      select: () => query,
      delete: () => query,
      eq: () => query,
      order: () => query,
      range: async () => page,
      then: (resolve: (value: typeof page) => unknown) =>
        Promise.resolve(page).then(resolve),
    };
    const client = {
      from: vi.fn(() => query),
    } as unknown as RepositorySupabaseClient;
    return new SupabaseMealIllustrationRepository({
      serviceClient: client,
      clientFor: () => client,
    });
  }
  it("normalizes real PostgREST offset timestamps for the strict export DTO", async () => {
    const repository = repositoryWithPage({
      data: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          source_entry_id: "00000000-0000-4000-8000-000000000002",
          user_id: "00000000-0000-4000-8000-000000000003",
          dish_key: "a".repeat(64),
          state: "ready",
          image_base64: "AQID",
          created_at: "2026-10-09T08:00:00+00:00",
          lease_until: "2026-10-09T08:02:00+00:00",
        },
      ],
      error: null,
    });
    const [record] = await repository.exportForUser(
      "owner" as UserId,
      "synthetic-token",
    );
    expect(record?.createdAt).toBe("2026-10-09T08:00:00.000Z");
    expect(record?.leaseUntil).toBe("2026-10-09T08:02:00.000Z");
  });
  it("allows only exact absent relations and fails closed on stale schema or unrelated missing tables", async () => {
    const owner = "owner" as UserId;
    const absent = repositoryWithPage({
      data: [],
      error: {
        code: "42P01",
        message: 'relation "public.meal_illustrations" does not exist',
      },
    });
    expect(await absent.exportForUser(owner, "token")).toEqual([]);
    await expect(
      absent.invalidateForEntry(owner, "source"),
    ).resolves.toBeUndefined();
    const usageAbsent = repositoryWithPage({
      data: [],
      error: {
        code: "42P01",
        message:
          'relation "public.meal_illustration_user_usage" does not exist',
      },
    });
    expect(await usageAbsent.exportUsageForUser(owner, "token")).toEqual([]);
    for (const error of [
      {
        code: "PGRST205",
        message: "Could not find the table in the schema cache",
      },
      { code: "42P01", message: 'relation "private_other" does not exist' },
      { code: "42501", message: "Permission denied" },
    ]) {
      const denied = repositoryWithPage({ data: [], error });
      await expect(denied.exportForUser(owner, "token")).rejects.toThrow(
        "Illustration export failed",
      );
      await expect(denied.exportUsageForUser(owner, "token")).rejects.toThrow(
        "Illustration usage export failed",
      );
      await expect(denied.deleteForUser(owner)).rejects.toThrow(
        "Illustration deletion failed",
      );
    }
  });
  it("fails closed when admission or completion RPC fails", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [],
      error: { message: "private database context" },
    });
    const client = { rpc } as unknown as RepositorySupabaseClient;
    const repository = new SupabaseMealIllustrationRepository({
      serviceClient: client,
      clientFor: () => client,
    });
    await expect(
      repository.claim(
        "owner" as UserId,
        "a".repeat(64),
        "current",
        "source-id",
      ),
    ).rejects.toThrow("Illustration admission failed");
    await expect(
      repository.complete(
        "owner" as UserId,
        "id",
        { key: "a".repeat(64), base64: "AQID", mimeType: "image/jpeg" },
        "current",
      ),
    ).rejects.toThrow("Illustration persistence failed");
  });
});
