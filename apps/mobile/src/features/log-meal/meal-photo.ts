import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

const MAX_MEAL_IMAGE_EDGE = 2048;

export interface MealPhotoAssetInput {
  readonly uri: string;
  readonly width?: number;
  readonly height?: number;
}

export interface MealPhotoNormalizationOptions {
  /** Track a generated cache file before validation so failures remain cleanable. */
  readonly onTemporaryFile?: (file: File) => void | Promise<void>;
}

export const normalizeMealPhoto = async (
  asset: MealPhotoAssetInput,
  options: MealPhotoNormalizationOptions = {},
): Promise<File> => {
  const context = ImageManipulator.manipulate(asset.uri);
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  const longestEdge = Math.max(width, height);
  if (longestEdge > MAX_MEAL_IMAGE_EDGE) {
    if (width >= height) {
      context.resize({ width: MAX_MEAL_IMAGE_EDGE, height: null });
    } else {
      context.resize({ width: null, height: MAX_MEAL_IMAGE_EDGE });
    }
  }
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  try {
    rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      compress: 0.82,
      format: SaveFormat.JPEG,
    });
    const file = new File(saved.uri);
    await options.onTemporaryFile?.(file);
    if (!file.exists || file.size <= 0) {
      throw new Error("The selected photo could not be read.");
    }
    return file;
  } finally {
    rendered?.release();
    context.release();
  }
};
