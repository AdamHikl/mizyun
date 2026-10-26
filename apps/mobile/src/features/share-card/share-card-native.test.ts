import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  viewShot: true as boolean,
  sharing: true as boolean,
  calls: [] as string[],
  platform: { OS: "ios" as "ios" | "android" },
}));

vi.mock("react-native", () => ({
  Platform: native.platform,
  PixelRatio: { get: () => 3 },
  TurboModuleRegistry: {
    get: (name: string) =>
      name === "RNViewShot" && native.viewShot ? {} : null,
  },
}));
vi.mock("react-native-view-shot", () => ({
  captureRef: vi.fn(async (_ref: unknown, options: object) => {
    native.calls.push(`capture ${JSON.stringify(options)}`);
    return "/cache/card.png";
  }),
  releaseCapture: vi.fn((uri: string) => native.calls.push(`release ${uri}`)),
}));
vi.mock("expo-sharing", () => ({
  isAvailableAsync: async () => true,
  shareAsync: vi.fn(async (uri: string, options: { mimeType: string }) => {
    native.calls.push(`share ${uri} ${options.mimeType}`);
  }),
}));
vi.mock("./share-card-view", () => ({
  SHARE_CARD_EXPORT_WIDTH_PX: 1080,
  SHARE_CARD_EXPORT_HEIGHT_PX: 1350,
}));

import * as sharing from "expo-sharing";
import {
  isShareCardAvailable,
  releaseShareCardImage,
  shareCardImage,
} from "./share-card-native";

const ref = { current: {} as never };

beforeEach(async () => {
  native.platform.OS = "ios";
  await releaseShareCardImage();
  native.viewShot = true;
  native.sharing = true;
  native.calls = [];
  (globalThis as any).expo = {
    modules: new Proxy(
      {},
      {
        get: (_t, name) =>
          name === "ExpoSharing" && native.sharing ? {} : undefined,
      },
    ),
  };
});

describe("share card native bridge", () => {
  it("is unavailable in builds without either native module", async () => {
    expect(isShareCardAvailable()).toBe(true);
    native.viewShot = false;
    expect(isShareCardAvailable()).toBe(false);
    expect(await shareCardImage(ref)).toEqual({ kind: "unavailable" });
    native.viewShot = true;
    native.sharing = false;
    expect(isShareCardAvailable()).toBe(false);
    expect(native.calls).toEqual([]);
  });

  it("captures a 1080 × 1350 PNG, shares it and releases it on close", async () => {
    expect(await shareCardImage(ref)).toEqual({ kind: "shared" });
    expect(native.calls).toEqual([
      `capture ${JSON.stringify({ format: "png", quality: 1, result: "tmpfile", width: 360, height: 450 })}`,
      "share file:///cache/card.png image/png",
    ]);
    await releaseShareCardImage();
    expect(native.calls.at(-1)).toBe("release /cache/card.png");
  });

  it("asks Android for output pixels and releases the previous capture first", async () => {
    native.platform.OS = "android";
    await shareCardImage(ref);
    await shareCardImage(ref);
    expect(native.calls).toEqual([
      `capture ${JSON.stringify({ format: "png", quality: 1, result: "tmpfile", width: 1080, height: 1350 })}`,
      "share file:///cache/card.png image/png",
      "release /cache/card.png",
      `capture ${JSON.stringify({ format: "png", quality: 1, result: "tmpfile", width: 1080, height: 1350 })}`,
      "share file:///cache/card.png image/png",
    ]);
  });

  it("reports a failure and still releases the file on close", async () => {
    vi.mocked(sharing.shareAsync).mockRejectedValueOnce(new Error("boom"));
    expect(await shareCardImage(ref)).toMatchObject({ kind: "failed" });
    await releaseShareCardImage();
    expect(native.calls.at(-1)).toBe("release /cache/card.png");
  });
});
