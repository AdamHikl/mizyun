import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  normalizeIngredientImage,
  IngredientImageError,
  INGREDIENT_IMAGE_MAX_BYTES,
} from "./index.js";
describe("transient ingredient image normalization", () => {
  it("decodes, orients, bounds dimensions and strips metadata", async () => {
    const bytes = await sharp({
      create: { width: 2048, height: 512, channels: 3, background: "red" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const output = await normalizeIngredientImage(bytes, "image/jpeg");
    const metadata = await sharp(output.bytes).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(Math.max(metadata.width!, metadata.height!)).toBe(1024);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });
  it("rejects mismatched MIME, malformed/truncated pixels and unsupported content", async () => {
    const png = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    for (const [bytes, type] of [
      [png, "image/jpeg"],
      [png.subarray(0, 30), "image/png"],
      [Buffer.from("<svg/>"), "image/png"],
      [png, "image/gif"],
    ] as const)
      await expect(
        normalizeIngredientImage(bytes, type),
      ).rejects.toBeInstanceOf(IngredientImageError);
  });
  it("rejects oversized bytes and dimensions before sending to a provider", async () => {
    await expect(
      normalizeIngredientImage(
        new Uint8Array(INGREDIENT_IMAGE_MAX_BYTES + 1),
        "image/jpeg",
      ),
    ).rejects.toBeInstanceOf(IngredientImageError);
    const png = await sharp({
      create: { width: 4097, height: 1, channels: 3, background: "black" },
    })
      .png()
      .toBuffer();
    await expect(
      normalizeIngredientImage(png, "image/png"),
    ).rejects.toBeInstanceOf(IngredientImageError);
  });
});
