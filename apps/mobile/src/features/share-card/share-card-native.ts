import type { RefObject } from "react";
import {
  PixelRatio,
  Platform,
  TurboModuleRegistry,
  type View,
} from "react-native";

import {
  SHARE_CARD_EXPORT_HEIGHT_PX,
  SHARE_CARD_EXPORT_WIDTH_PX,
} from "./share-card-view";

/**
 * True when this binary contains both native modules (ADR-0082). Builds
 * installed before the card shipped lack them, so the action stays hidden
 * there instead of failing; importing view-shot in such a build would throw.
 */
export const isShareCardAvailable = (): boolean => {
  try {
    // Expo modules install on `globalThis.expo.modules` (the same lookup as
    // `requireOptionalNativeModule`, without loading `expo` at import time).
    const expoModules = (
      globalThis as { expo?: { modules?: Record<string, unknown> } }
    ).expo?.modules;
    return (
      TurboModuleRegistry.get("RNViewShot") != null &&
      (expoModules?.ExpoSharing ?? TurboModuleRegistry.get("ExpoSharing")) !=
        null
    );
  } catch {
    return false;
  }
};

export type ShareCardOutcome =
  | { readonly kind: "shared" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed"; readonly message: string };

/** The last capture, kept until the sheet closes or the next capture. */
let lastCapture: string | null = null;

/**
 * Deletes the last temporary PNG. Android targets may read the shared file
 * after the chooser returns, so this runs when the preview closes rather
 * than as soon as `shareAsync` resolves.
 */
export async function releaseShareCardImage(): Promise<void> {
  const uri = lastCapture;
  lastCapture = null;
  if (!uri || !isShareCardAvailable()) return;
  try {
    (await import("react-native-view-shot")).releaseCapture(uri);
  } catch {
    // The OS clears the cache directory anyway.
  }
}

/**
 * Captures the on-screen card as a 1080 × 1350 PNG in the app cache and
 * hands it to the system share sheet. Nothing leaves the device unless the
 * user picks a target there.
 */
export async function shareCardImage(
  card: RefObject<View | null>,
): Promise<ShareCardOutcome> {
  if (!isShareCardAvailable() || !card.current) return { kind: "unavailable" };
  await releaseShareCardImage();
  const [viewShot, sharing] = await Promise.all([
    import("react-native-view-shot"),
    import("expo-sharing"),
  ]);
  try {
    if (!(await sharing.isAvailableAsync())) return { kind: "unavailable" };
    // iOS reads width/height in points and renders at screen scale; Android
    // reads them as output pixels.
    const scale = Platform.OS === "android" ? 1 : PixelRatio.get();
    const uri = await viewShot.captureRef(card, {
      format: "png",
      quality: 1,
      result: "tmpfile",
      width: SHARE_CARD_EXPORT_WIDTH_PX / scale,
      height: SHARE_CARD_EXPORT_HEIGHT_PX / scale,
    });
    lastCapture = uri;
    await sharing.shareAsync(
      uri.startsWith("file://") ? uri : `file://${uri}`,
      {
        mimeType: "image/png",
        UTI: "public.png",
        dialogTitle: "Share session card",
      },
    );
    return { kind: "shared" };
  } catch {
    return {
      kind: "failed",
      message: "Couldn't create or share the image. Try again.",
    };
  }
}
