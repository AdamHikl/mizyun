import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  owner: "owner-a",
  token: "token-a",
  enabled: true,
  pending: vi.fn(),
  read: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  discard: vi.fn(),
}));
const hooks = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
  cleanup: [] as (() => void)[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const i = hooks.index++;
    if (!(i in hooks.slots)) hooks.slots[i] = initial;
    return [
      hooks.slots[i],
      (next: any) => {
        hooks.slots[i] =
          typeof next === "function" ? next(hooks.slots[i]) : next;
      },
    ];
  },
  useRef: (initial: unknown) =>
    (hooks.slots[hooks.index++] ??= { current: initial }),
  useEffect: (effect: () => any, deps: any[]) => {
    const i = hooks.index++;
    const previous = hooks.slots[i];
    if (
      !previous ||
      !previous.every((value: any, j: number) => Object.is(value, deps[j]))
    ) {
      hooks.cleanup[i]?.();
      hooks.slots[i] = deps;
      hooks.effects.push(() => {
        hooks.cleanup[i] = effect();
      });
    }
  },
}));
vi.mock("react-native", () => ({
  Modal: "Modal",
  Pressable: "Pressable",
  View: "View",
}));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: mocks.owner }, accessToken: mocks.token },
  }),
}));
vi.mock("./meal-photo-retention", () => ({
  mealPhotoRetentionEnabled: () => mocks.enabled,
  loadMealPhotoRetry: mocks.pending,
  fetchMealPhoto: mocks.read,
  uploadMealPhotoRetry: mocks.upload,
  deleteMealPhoto: mocks.remove,
  removeMealPhotoRetry: mocks.discard,
}));
import { PrivateMealPhoto } from "./private-meal-photo";
const photo = {
  assetId: "asset-a",
  width: 640,
  height: 320,
  signedUrl: "https://private.example/photo",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
let hasPhoto = true;
function render(): any {
  hooks.index = 0;
  const tree = PrivateMealPhoto({
    entryId: "meal-a",
    hasPhoto,
    editable: true,
  });
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
function find(tree: any, match: (node: any) => boolean): any {
  if (!tree || typeof tree !== "object") return null;
  if (Array.isArray(tree))
    return tree.map((node) => find(node, match)).find(Boolean);
  return match(tree) ? tree : find(tree.props?.children, match);
}
function byLabel(label: string) {
  return find(render(), (node) => node.props?.accessibilityLabel === label);
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
beforeEach(async () => {
  hooks.slots = [];
  hooks.effects = [];
  hooks.cleanup = [];
  vi.clearAllMocks();
  mocks.owner = "owner-a";
  mocks.token = "token-a";
  mocks.enabled = true;
  hasPhoto = true;
  mocks.pending.mockResolvedValue(null);
  mocks.read.mockResolvedValue({ ok: true, value: { photo } });
  mocks.upload.mockResolvedValue(true);
  mocks.remove.mockResolvedValue({ ok: true });
  mocks.discard.mockResolvedValue(true);
});
it("uses a 60pt private tile and opens a larger preview with caching disabled", async () => {
  render();
  await flush();
  const tile = byLabel("View meal photo");
  expect(tile.props.style).toEqual({ width: 60, height: 60 });
  const image = byLabel("Meal photo");
  expect(image.props.cachePolicy).toBe("none");
  tile.props.onPress();
  const preview = byLabel("Meal photo preview");
  expect(preview.props.cachePolicy).toBe("none");
  expect(preview.props.source.uri).toBe(photo.signedUrl);
  byLabel("Close meal photo preview").props.onPress();
  expect(byLabel("Meal photo preview")).toBeFalsy();
});
it("drops a signed URL arriving after an account switch", async () => {
  let resolve!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render();
  await flush();
  mocks.owner = "owner-b";
  mocks.read.mockResolvedValueOnce({ ok: true, value: { photo: null } });
  render();
  await flush();
  resolve({ ok: true, value: { photo } });
  await flush();
  expect(byLabel("Meal photo")).toBeFalsy();
  expect(mocks.pending).toHaveBeenLastCalledWith("owner-b", "meal-a");
});
it("hides an already-open preview immediately after a token/account change", async () => {
  render();
  await flush();
  byLabel("View meal photo").props.onPress();
  expect(byLabel("Meal photo preview")).toBeTruthy();
  mocks.token = "token-b";
  expect(byLabel("Meal photo preview")).toBeFalsy();
});
it("recovers a pending upload for a saved meal and offers Retry and Discard", async () => {
  hasPhoto = false;
  mocks.pending.mockResolvedValue({ uri: "owned-retry" });
  mocks.read.mockResolvedValue({ ok: true, value: { photo: null } });
  render();
  await flush();
  byLabel("Retry meal photo upload").props.onPress();
  await flush();
  expect(mocks.upload).toHaveBeenCalledWith(
    "owner-a",
    "meal-a",
    expect.any(Function),
  );
  byLabel("Discard pending meal photo").props.onPress();
  await flush();
  expect(mocks.discard).toHaveBeenCalledWith("owner-a", "meal-a");
});
it("removes the photo independently of the meal", async () => {
  render();
  await flush();
  mocks.read.mockResolvedValueOnce({ ok: true, value: { photo: null } });
  byLabel("Remove saved meal photo").props.onPress();
  await flush();
  expect(mocks.remove).toHaveBeenCalledWith("meal-a");
  expect(byLabel("Meal photo")).toBeFalsy();
});
it("does not fetch images for meals without a photo or pending retry", async () => {
  hasPhoto = false;
  render();
  await flush();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(render()).toBeNull();
});
it("renders no private image in Production", async () => {
  mocks.enabled = false;
  expect(render()).toBeNull();
  await flush();
  expect(mocks.read).not.toHaveBeenCalled();
});

it("removes a photo from its preview and cancels an unresolved local retry", async () => {
  render();
  await flush();
  byLabel("View meal photo").props.onPress();
  byLabel("Remove meal photo from preview").props.onPress();
  await flush();
  expect(mocks.remove).toHaveBeenCalledWith("meal-a");
  expect(mocks.discard).toHaveBeenCalledWith("owner-a", "meal-a");
  expect(byLabel("Meal photo preview")).toBeFalsy();
});
