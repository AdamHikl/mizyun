import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  value: null as any,
  owner: "owner-a" as string | null,
  localUri: null as string | null,
  record: null as { assetId: string | null } | null,
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: state.owner ? { user: { id: state.owner } } : null,
  }),
}));
vi.mock("@/features/private-photos/local-photo-library", () => ({
  useLocalPhotoUri: () => state.localUri,
  localPhotoRecord: () => state.record,
}));
vi.mock("./local-meal-photo", () => ({ LocalMealPhoto: "LocalPhoto" }));
vi.mock("react", () => ({
  useState: () => [
    state.value,
    (value: any) => {
      state.value = value;
    },
  ],
}));
vi.mock("./private-meal-photo", () => ({ PrivateMealPhoto: "Photo" }));
vi.mock("./automatic-meal-illustration", () => ({
  AutomaticMealIllustration: "Illustration",
}));
import { MealVisual } from "./meal-visual";
beforeEach(() => {
  state.value = null;
  state.owner = "owner-a";
  state.localUri = null;
  state.record = null;
});
it("starts automatic generation immediately after removing a real photo", () => {
  const props = {
    enabled: true,
    entryId: "meal-a",
    name: "Unusual dish",
    hasPhoto: true,
    editable: true,
  };
  const before: any = MealVisual(props);
  expect(before.props.fallback.props.allowGeneration).toBe(false);
  before.props.onPhotoRemoved();
  const after: any = MealVisual(props);
  expect(after.props.fallback.props.allowGeneration).toBe(true);
  expect(
    (MealVisual({ ...props, entryId: "meal-b" }) as any).props.fallback.props
      .allowGeneration,
  ).toBe(false);
});

it("hides photos and illustrations when Pro capability is unavailable or revoked", () => {
  const props = {
    enabled: true,
    entryId: "meal-a",
    name: "Toast",
    hasPhoto: true,
  };
  expect(MealVisual(props)).not.toBeNull();
  expect(MealVisual({ ...props, enabled: false })).toBeNull();
});

it("keeps individual erasure available without displaying locked media", () => {
  const locked: any = MealVisual({
    enabled: false,
    entryId: "meal-a",
    name: "Toast",
    hasPhoto: true,
    editable: true,
  });
  expect(locked.props.displayEnabled).toBe(false);
  expect(locked.props.fallback).toBeUndefined();
  expect(locked.props.editable).toBe(true);
});

it("shows this phone's copy without Pro or a server photo (ADR-0079)", () => {
  state.localUri = "file:///private-photos/meal-a.jpg";
  state.record = { assetId: null };
  const element: any = MealVisual({
    enabled: false,
    entryId: "meal-a",
    name: "Toast",
    hasPhoto: false,
    editable: true,
  });
  expect(element.type).toBe("LocalPhoto");
  expect(element.props).toMatchObject({
    owner: "owner-a",
    entryId: "meal-a",
    uri: "file:///private-photos/meal-a.jpg",
    hasServerCopy: false,
    editable: true,
  });
});

it("passes whether a server backup exists to the device photo", () => {
  state.localUri = "file:///private-photos/meal-a.jpg";
  state.record = { assetId: "asset-a" };
  const element: any = MealVisual({
    enabled: true,
    entryId: "meal-a",
    name: "Toast",
    hasPhoto: true,
    photoAssetId: "asset-a",
  });
  expect(element.type).toBe("LocalPhoto");
  expect(element.props.hasServerCopy).toBe(true);
});

it("ignores a stale device copy so the server photo replaces it", () => {
  state.localUri = "file:///private-photos/meal-a.jpg";
  state.record = { assetId: "asset-old" };
  const element: any = MealVisual({
    enabled: true,
    entryId: "meal-a",
    name: "Toast",
    hasPhoto: true,
    photoAssetId: "asset-new",
  });
  expect(element.type).toBe("Photo");
  expect(element.props.photoAssetId).toBe("asset-new");
  expect(element.props.hasPhoto).toBe(true);
});

it("uses the server path with no photo after the device copy is removed", () => {
  state.localUri = "file:///private-photos/meal-a.jpg";
  state.record = { assetId: "asset-a" };
  const props = {
    enabled: true,
    entryId: "meal-a",
    name: "Toast",
    hasPhoto: true,
    photoAssetId: "asset-a",
    editable: true,
  };
  const local: any = MealVisual(props);
  local.props.onPhotoRemoved();
  const after: any = MealVisual(props);
  expect(after.type).toBe("Photo");
  expect(after.props.hasPhoto).toBe(false);
});

it("never shows a device copy without a signed-in owner", () => {
  state.owner = null;
  state.localUri = "file:///private-photos/meal-a.jpg";
  const element: any = MealVisual({
    enabled: true,
    entryId: "meal-a",
    name: "Toast",
    hasPhoto: false,
  });
  expect(element.type).toBe("Photo");
});
