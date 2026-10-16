import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import type { PreparedBoulderPhoto } from "./boulder-photo";

const MAX_IMAGE_EDGE = 2048;

/**
 * Resize to a 2048 px longest edge and re-encode as JPEG, exactly like
 * progress photos. The re-encode drops EXIF/GPS metadata from the bytes.
 */
export async function prepareBoulderPhoto(
  asset: ImagePicker.ImagePickerAsset,
): Promise<PreparedBoulderPhoto> {
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > MAX_IMAGE_EDGE) {
    if (asset.width >= asset.height)
      context.resize({ width: MAX_IMAGE_EDGE, height: null });
    else context.resize({ width: null, height: MAX_IMAGE_EDGE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    compress: 0.85,
    format: SaveFormat.JPEG,
  });
  const file = new File(saved.uri);
  if (!file.exists || file.size <= 0)
    throw new Error("The selected photo could not be read.");
  return {
    uri: saved.uri,
    mimeType: "image/jpeg",
    byteSize: file.size,
    width: saved.width,
    height: saved.height,
  };
}

export type PickedBoulderPhoto =
  | { readonly kind: "photo"; readonly photo: PreparedBoulderPhoto }
  | { readonly kind: "cancelled" }
  | { readonly kind: "error"; readonly message: string };

/** Camera or library → prepared JPEG. Permission denial is an explained error. */
export async function pickBoulderPhoto(
  source: "camera" | "library",
): Promise<PickedBoulderPhoto> {
  try {
    if (source === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted)
        return {
          kind: "error",
          message:
            "Camera access is off. Allow it in Settings or choose a photo from your library.",
        };
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      allowsEditing: false,
      allowsMultipleSelection: false,
      exif: false,
      quality: 1,
    };
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return { kind: "cancelled" };
    return { kind: "photo", photo: await prepareBoulderPhoto(asset) };
  } catch (cause) {
    return {
      kind: "error",
      message:
        cause instanceof Error && cause.message
          ? cause.message
          : "The photo couldn't be prepared.",
    };
  }
}
