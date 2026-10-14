import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  load: vi.fn(),
  normalize: vi.fn().mockResolvedValue({ uri: "synthetic://normalized" }),
}));
vi.mock("../log-meal/meal-photo", () => {
  m.load();
  return { normalizeMealPhoto: m.normalize };
});
import { createOperationId, normalizeMealPhoto } from "../log-meal/public-data";
it("data-only public imports do not load the native image SDK, and photo calls forward cleanup ownership", async () => {
  expect(typeof createOperationId).toBe("function");
  expect(m.load).not.toHaveBeenCalled();
  const asset = { uri: "synthetic://source" };
  const options = { onTemporaryFile: vi.fn() };
  expect(await normalizeMealPhoto(asset, options)).toEqual({
    uri: "synthetic://normalized",
  });
  expect(m.load).toHaveBeenCalledOnce();
  expect(m.normalize).toHaveBeenCalledExactlyOnceWith(asset, options);
});
