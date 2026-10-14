import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  exists: true,
  size: 1,
  save: vi.fn(),
  render: vi.fn(),
  resize: vi.fn(),
  release: vi.fn(),
  renderedRelease: vi.fn(),
}));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(readonly uri: string) {}
    get exists() {
      return m.exists;
    }
    get size() {
      return m.size;
    }
  },
}));
vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: {
    manipulate: () => ({
      resize: m.resize,
      renderAsync: m.render,
      release: m.release,
    }),
  },
}));
import { normalizeMealPhoto } from "./meal-photo";
beforeEach(() => {
  vi.clearAllMocks();
  m.exists = true;
  m.size = 1;
  m.save.mockResolvedValue({ uri: "cache://output.jpg" });
  m.render.mockResolvedValue({ saveAsync: m.save, release: m.renderedRelease });
});
it("reports generated ownership before validation and releases native refs on failure", async () => {
  m.size = 0;
  const track = vi.fn();
  await expect(
    normalizeMealPhoto(
      { uri: "cache://input.heic" },
      { onTemporaryFile: track },
    ),
  ).rejects.toThrow("could not be read");
  expect(track).toHaveBeenCalledWith(
    expect.objectContaining({ uri: "cache://output.jpg" }),
  );
  expect(m.release).toHaveBeenCalledOnce();
  expect(m.renderedRelease).toHaveBeenCalledOnce();
});
it("preserves old-call JPEG normalization and releases refs on success", async () => {
  expect(
    (await normalizeMealPhoto({ uri: "input", width: 4000, height: 2000 })).uri,
  ).toBe("cache://output.jpg");
  expect(m.resize).toHaveBeenCalledWith({ width: 2048, height: null });
  expect(m.save).toHaveBeenCalledWith({ compress: 0.82, format: "jpeg" });
  expect(m.release).toHaveBeenCalledOnce();
});
it("releases context even when decode fails before a render reference exists", async () => {
  m.render.mockRejectedValue(new Error("decode"));
  await expect(normalizeMealPhoto({ uri: "corrupt" })).rejects.toThrow(
    "decode",
  );
  expect(m.release).toHaveBeenCalledOnce();
  expect(m.renderedRelease).not.toHaveBeenCalled();
});
