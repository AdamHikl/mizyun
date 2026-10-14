import sharp from "sharp";

export const INGREDIENT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const INGREDIENT_IMAGE_MAX_PIXELS = 16_777_216;
export const INGREDIENT_IMAGE_MAX_DIMENSION = 4096;
export class IngredientImageError extends Error {
  constructor() {
    super("Unsupported or invalid ingredient image");
    this.name = "IngredientImageError";
  }
}
/** Decode untrusted raster pixels, reject animation and re-encode without metadata.
 * No filesystem paths, remote URLs, retained files or provider calls are accepted.
 */
export async function normalizeIngredientImage(
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ mimeType: "image/jpeg"; bytes: Uint8Array }> {
  if (
    !bytes.byteLength ||
    bytes.byteLength > INGREDIENT_IMAGE_MAX_BYTES ||
    !["image/jpeg", "image/png", "image/webp"].includes(mimeType)
  )
    throw new IngredientImageError();
  try {
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: INGREDIENT_IMAGE_MAX_PIXELS,
      limitInputChannels: 4,
      animated: false,
    });
    const meta = await image.metadata();
    const expected = {
      "image/jpeg": "jpeg",
      "image/png": "png",
      "image/webp": "webp",
    }[mimeType];
    if (
      meta.format !== expected ||
      !meta.width ||
      !meta.height ||
      meta.width > INGREDIENT_IMAGE_MAX_DIMENSION ||
      meta.height > INGREDIENT_IMAGE_MAX_DIMENSION ||
      (meta.pages ?? 1) !== 1
    )
      throw new IngredientImageError();
    const output = await image
      .rotate()
      .resize({
        width: 1024,
        height: 1024,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "white" })
      .jpeg({ quality: 85 })
      .toBuffer();
    if (output.byteLength > 1024 * 1024) throw new IngredientImageError();
    return { mimeType: "image/jpeg", bytes: new Uint8Array(output) };
  } catch {
    throw new IngredientImageError();
  }
}
