import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => {
  require.extensions[".png"] = (
    module: { exports: unknown },
    filename: string,
  ) => {
    module.exports = filename;
  };
  return { failedUri: null as string | null };
});
vi.mock("react", () => ({
  useState: () => [
    state.failedUri,
    (uri: string) => {
      state.failedUri = uri;
    },
  ],
}));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("expo-image", () => ({ Image: "Image" }));
import { MealIllustrationTile } from "./meal-illustration-tile";
beforeEach(() => {
  state.failedUri = null;
});
it("allocates no placeholder or empty plate for an unfamiliar meal", () => {
  expect(MealIllustrationTile({ name: "Unfamiliar dinner" })).toBeNull();
});
it("shows generated artwork and removes a failed unknown image", () => {
  const props = {
    name: "Unfamiliar dinner",
    uri: "data:image/jpeg;base64,AQID",
  };
  const tile: any = MealIllustrationTile(props);
  expect(tile.props.children.props.source).toEqual({ uri: props.uri });
  tile.props.children.props.onError();
  expect(MealIllustrationTile(props)).toBeNull();
});
it("falls back to the correct food category after generated image failure", () => {
  const props = { name: "Vanilla pudding", uri: "data:image/jpeg;base64,AQID" };
  const tile: any = MealIllustrationTile(props);
  tile.props.children.props.onError();
  const fallback: any = MealIllustrationTile(props);
  expect(fallback.props.children.props.style).toMatchObject({
    left: -60,
    top: -0,
  });
  expect(fallback.props.children.props.cachePolicy).toBe("memory-disk");
});
