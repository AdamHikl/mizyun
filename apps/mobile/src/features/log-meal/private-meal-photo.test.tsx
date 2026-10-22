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
  keep: vi.fn(),
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
vi.mock("./meal-photo-download", () => ({
  keepMealBackupOnDevice: mocks.keep,
}));
import { PrivateMealPhoto } from "./private-meal-photo";
import { forgetMealVisualMemory } from "./meal-photo-memory";
const photo = {
  assetId: "asset-a",
  width: 640,
  height: 320,
  signedUrl: "https://private.example/photo",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
let hasPhoto = true;
let fallback: any = null;
let displayEnabled = true;
let editable = true;
let photoAssetId: string | undefined;
function render(): any {
  hooks.index = 0;
  const tree = PrivateMealPhoto({
    entryId: "meal-a",
    hasPhoto,
    photoAssetId,
    editable,
    fallback,
    displayEnabled,
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
  forgetMealVisualMemory();
  photoAssetId = undefined;
  mocks.owner = "owner-a";
  mocks.token = "token-a";
  mocks.enabled = true;
  hasPhoto = true;
  fallback = null;
  displayEnabled = true;
  editable = true;
  mocks.pending.mockResolvedValue(null);
  mocks.read.mockResolvedValue({ ok: true, value: { photo } });
  mocks.upload.mockResolvedValue(true);
  mocks.remove.mockResolvedValue({ ok: true });
  mocks.discard.mockResolvedValue(true);
});
it("uses a 60pt private tile and opens a larger preview with memory-only caching", async () => {
  render();
  await flush();
  const tile = byLabel("View meal photo");
  expect(tile.props.style).toEqual({ width: 60, height: 60 });
  const image = byLabel("Meal photo");
  expect(image.props.cachePolicy).toBe("memory");
  // The first successful read also saves the photo on this phone (ADR-0079).
  expect(mocks.keep).toHaveBeenCalledWith("owner-a", "meal-a", photo);
  tile.props.onPress();
  const preview = byLabel("Meal photo preview");
  expect(preview.props.cachePolicy).toBe("memory");
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

it("renders the automatic illustration without photo infrastructure or a saved photo", async () => {
  fallback = { type: "Illustration", props: { name: "Oatmeal" } };
  hasPhoto = false;
  expect(render()).toBe(fallback);
  await flush();
  expect(mocks.read).not.toHaveBeenCalled();
  mocks.enabled = false;
  expect(render()).toBe(fallback);
});

it("a real photo replaces the illustration and removal restores it", async () => {
  fallback = { type: "Illustration", props: { name: "Oatmeal" } };
  render();
  await flush();
  expect(find(render(), (node) => node === fallback)).toBeFalsy();
  mocks.read.mockResolvedValueOnce({ ok: true, value: { photo: null } });
  byLabel("Remove saved meal photo").props.onPress();
  await flush();
  expect(find(render(), (node) => node === fallback)).toBe(fallback);
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

it("offers Free text-only erasure without fetching, signing, displaying, or uploading photos", async () => {
  displayEnabled = false;
  fallback = { type: "Illustration", props: {} };
  render();
  await flush();
  const tree = render();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(
    find(
      tree,
      (node) =>
        node.type === "Image" || node.type === "Modal" || node === fallback,
    ),
  ).toBeFalsy();
  expect(byLabel("Reload meal photo")).toBeFalsy();
  expect(byLabel("Retry meal photo upload")).toBeFalsy();
  byLabel("Remove saved meal photo").props.onPress();
  await flush();
  expect(mocks.remove).toHaveBeenCalledWith("meal-a");
  expect(mocks.discard).toHaveBeenCalledWith("owner-a", "meal-a");
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(render()).toBeNull();
});

it("allows text-only erasure when photo retention infrastructure is disabled", async () => {
  displayEnabled = false;
  mocks.enabled = false;
  render();
  await flush();
  byLabel("Remove saved meal photo").props.onPress();
  await flush();
  expect(mocks.remove).toHaveBeenCalledWith("meal-a");
  expect(mocks.read).not.toHaveBeenCalled();
});

it("lets Free users discard a local pending photo without image reads or retry controls", async () => {
  displayEnabled = false;
  hasPhoto = false;
  mocks.pending.mockResolvedValue({ uri: "owned-pending-photo" });
  render();
  await flush();
  expect(byLabel("Discard pending meal photo")).toBeTruthy();
  expect(byLabel("Retry meal photo upload")).toBeFalsy();
  expect(byLabel("Reload meal photo")).toBeFalsy();
  byLabel("Discard pending meal photo").props.onPress();
  await flush();
  expect(mocks.discard).toHaveBeenCalledWith("owner-a", "meal-a");
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(render()).toBeNull();
});

it("hides a ready image and open preview immediately when display access is revoked", async () => {
  render();
  await flush();
  byLabel("View meal photo").props.onPress();
  expect(byLabel("Meal photo preview")).toBeTruthy();
  const previousReadCount = mocks.read.mock.calls.length;
  displayEnabled = false;
  const tree = render();
  expect(
    find(tree, (node) => node.type === "Image" || node.type === "Modal"),
  ).toBeFalsy();
  await flush();
  expect(mocks.read).toHaveBeenCalledTimes(previousReadCount);
  expect(byLabel("Remove saved meal photo")).toBeTruthy();
});

it("blocks a previously captured Retry handler and cancels its authority after display revocation", async () => {
  hasPhoto = false;
  mocks.pending.mockResolvedValue({ uri: "owned-pending-photo" });
  mocks.read.mockResolvedValue({ ok: true, value: { photo: null } });
  render();
  await flush();
  const retry = byLabel("Retry meal photo upload").props.onPress;
  displayEnabled = false;
  render();
  retry();
  await flush();
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(byLabel("Retry meal photo upload")).toBeFalsy();
});

it("retires an in-flight retry before it can restore a photo after display revocation", async () => {
  hasPhoto = false;
  mocks.pending.mockResolvedValue({ uri: "owned-pending-photo" });
  mocks.read.mockResolvedValue({ ok: true, value: { photo: null } });
  let finish!: (value: boolean) => void;
  mocks.upload.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render();
  await flush();
  byLabel("Retry meal photo upload").props.onPress();
  await flush();
  const isCurrent = mocks.upload.mock.calls[0]![2];
  expect(isCurrent()).toBe(true);
  const previousReads = mocks.read.mock.calls.length;
  displayEnabled = false;
  render();
  expect(isCurrent()).toBe(false);
  finish(true);
  await flush();
  expect(mocks.read).toHaveBeenCalledTimes(previousReads);
  expect(byLabel("Meal photo")).toBeFalsy();
  expect(byLabel("Discard pending meal photo")).toBeTruthy();
});

it("does not expose text erasure controls for noneditable Free rows", async () => {
  displayEnabled = false;
  editable = false;
  render();
  await flush();
  expect(render()).toBeNull();
  expect(mocks.read).not.toHaveBeenCalled();
});

it("rejects a previous account's late pending-photo read in text-only mode", async () => {
  displayEnabled = false;
  hasPhoto = false;
  let finish!: (value: unknown) => void;
  mocks.pending.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render();
  mocks.owner = "owner-b";
  mocks.token = "token-b";
  render();
  await flush();
  finish({ uri: "owned-by-previous-account" });
  await flush();
  expect(render()).toBeNull();
  expect(byLabel("Discard pending meal photo")).toBeFalsy();
  expect(mocks.read).not.toHaveBeenCalled();
});

it("holds the tile while resolving instead of flashing the illustration or a reload control", async () => {
  fallback = { type: "Illustration", props: { name: "Oatmeal" } };
  let resolve!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const tree = render();
  expect(find(tree, (node) => node === fallback)).toBeFalsy();
  expect(byLabel("Loading meal photo")).toBeTruthy();
  await flush();
  expect(byLabel("Reload meal photo")).toBeFalsy();
  resolve({ ok: true, value: { photo } });
  await flush();
  expect(byLabel("Meal photo")).toBeTruthy();
  expect(byLabel("Loading meal photo")).toBeFalsy();
});

it("offers reload only after a failed read settles", async () => {
  mocks.read.mockResolvedValueOnce({ ok: false, error: { kind: "network" } });
  render();
  await flush();
  expect(byLabel("Reload meal photo")).toBeTruthy();
  expect(byLabel("Loading meal photo")).toBeFalsy();
});

it("shows a remembered signed URL on the first render of a revisited screen without refetching", async () => {
  render();
  await flush();
  expect(mocks.read).toHaveBeenCalledTimes(1);
  hooks.slots = [];
  hooks.effects = [];
  hooks.cleanup = [];
  const tree = render();
  expect(
    find(tree, (node) => node.props?.accessibilityLabel === "Meal photo")?.props
      .source.uri,
  ).toBe(photo.signedUrl);
  await flush();
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(byLabel("Meal photo")).toBeTruthy();
});

it("does not reuse a remembered URL across tokens, replaced assets, removal or near expiry", async () => {
  photoAssetId = photo.assetId;
  render();
  await flush();
  const remount = () => {
    hooks.slots = [];
    hooks.effects = [];
    hooks.cleanup = [];
    return render();
  };
  mocks.token = "token-b";
  expect(
    find(remount(), (node) => node.props?.accessibilityLabel === "Meal photo"),
  ).toBeFalsy();
  await flush();
  expect(mocks.read).toHaveBeenCalledTimes(2);
  photoAssetId = "asset-b";
  expect(
    find(remount(), (node) => node.props?.accessibilityLabel === "Meal photo"),
  ).toBeFalsy();
  await flush();
  expect(mocks.read).toHaveBeenCalledTimes(3);
  photoAssetId = undefined;
  mocks.read.mockResolvedValueOnce({ ok: true, value: { photo: null } });
  byLabel("Remove saved meal photo").props.onPress();
  await flush();
  remount();
  await flush();
  expect(mocks.read).toHaveBeenCalledTimes(5);
  forgetMealVisualMemory();
  mocks.read.mockResolvedValue({
    ok: true,
    value: {
      photo: {
        ...photo,
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
      },
    },
  });
  remount();
  await flush();
  const reads = mocks.read.mock.calls.length;
  remount();
  await flush();
  expect(mocks.read).toHaveBeenCalledTimes(reads + 1);
});

it("does not remember a signed URL whose read settles after memory was forgotten", async () => {
  let resolve!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render();
  await flush();
  forgetMealVisualMemory();
  resolve({ ok: true, value: { photo } });
  await flush();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cleanup = [];
  render();
  await flush();
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it("shows the remembered photo on the first render after display returns on tab refocus", async () => {
  render();
  await flush();
  displayEnabled = false;
  render();
  await flush();
  displayEnabled = true;
  const tree = render();
  expect(
    find(tree, (node) => node.props?.accessibilityLabel === "Meal photo"),
  ).toBeTruthy();
  expect(
    find(
      tree,
      (node) => node.props?.accessibilityLabel === "Reload meal photo",
    ),
  ).toBeFalsy();
  await flush();
  expect(mocks.read).toHaveBeenCalledTimes(1);
});

it("joins an in-flight read instead of signing the same photo twice", async () => {
  let resolve!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render();
  await flush();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cleanup = [];
  render();
  await flush();
  resolve({ ok: true, value: { photo } });
  await flush();
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(byLabel("Meal photo")).toBeTruthy();
});

it("reads again instead of inheriting a failed in-flight prefetch", async () => {
  const { sharedPhotoRead, mealPhotoScope } =
    await import("./meal-photo-memory");
  let fail!: (value: unknown) => void;
  void sharedPhotoRead(
    mealPhotoScope("owner-a", "token-a", "meal-a"),
    () =>
      new Promise((done) => {
        fail = done;
      }),
  );
  render();
  await flush();
  fail({ ok: false, error: { kind: "http_error" } });
  await flush();
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(byLabel("Meal photo")).toBeTruthy();
});

it("keeps a pending retry visible when display returns with a remembered photo", async () => {
  mocks.pending.mockResolvedValue({ uri: "owned-retry" });
  render();
  await flush();
  displayEnabled = false;
  render();
  await flush();
  displayEnabled = true;
  const tree = render();
  expect(
    find(tree, (node) => node.props?.accessibilityLabel === "Meal photo"),
  ).toBeTruthy();
  expect(
    find(
      tree,
      (node) => node.props?.accessibilityLabel === "Retry meal photo upload",
    ),
  ).toBeTruthy();
});

it("bypasses a shared read when forced after removal", async () => {
  render();
  await flush();
  mocks.read.mockResolvedValueOnce({ ok: true, value: { photo: null } });
  byLabel("Remove saved meal photo").props.onPress();
  await flush();
  expect(mocks.read).toHaveBeenCalledTimes(2);
});
