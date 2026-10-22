import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  removeLocal: vi.fn(),
}));
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: { accessToken: "token-a" } }),
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
}));
vi.mock("react-native", () => ({
  Modal: "Modal",
  Pressable: "Pressable",
  View: "View",
}));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/features/private-photos/local-photo-library", () => ({
  removeLocalPhoto: mocks.removeLocal,
}));
vi.mock("./meal-photo-retention", () => ({ deleteMealPhoto: mocks.remove }));
import { LocalMealPhoto } from "./local-meal-photo";

const removed = vi.fn();
let hasServerCopy = true;
let editable = true;
function render(): any {
  hooks.index = 0;
  return LocalMealPhoto({
    owner: "owner-a",
    entryId: "meal-a",
    uri: "file:///private-photos/meal-a.jpg",
    hasServerCopy,
    editable,
    onPhotoRemoved: removed,
  });
}
function find(tree: any, match: (node: any) => boolean): any {
  if (!tree || typeof tree !== "object") return null;
  if (Array.isArray(tree))
    return tree.map((node) => find(node, match)).find(Boolean);
  return match(tree) ? tree : find(tree.props?.children, match);
}
const byLabel = (label: string) =>
  find(render(), (node) => node.props?.accessibilityLabel === label);
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
beforeEach(() => {
  hooks.slots = [];
  vi.clearAllMocks();
  hasServerCopy = true;
  editable = true;
  mocks.remove.mockResolvedValue({ ok: true });
  mocks.removeLocal.mockReturnValue(true);
});

it("shows the device file without network or disk caching", () => {
  const image = byLabel("Meal photo");
  expect(image.props.source).toEqual({
    uri: "file:///private-photos/meal-a.jpg",
  });
  expect(image.props.cachePolicy).toBe("none");
  byLabel("View meal photo").props.onPress();
  expect(byLabel("Meal photo preview").props.cachePolicy).toBe("none");
});

it("offers removal only when editable", () => {
  editable = false;
  expect(byLabel("Remove saved meal photo")).toBeFalsy();
});

it("deletes the server copy before the device copy", async () => {
  const order: string[] = [];
  mocks.remove.mockImplementation(async () => {
    order.push("server");
    return { ok: true };
  });
  mocks.removeLocal.mockImplementation(() => {
    order.push("device");
    return true;
  });
  byLabel("Remove saved meal photo").props.onPress();
  await flush();
  expect(mocks.remove).toHaveBeenCalledWith("meal-a");
  expect(order).toEqual(["server", "device"]);
  expect(mocks.removeLocal).toHaveBeenCalledWith("owner-a", "meal", "meal-a");
  expect(removed).toHaveBeenCalledTimes(1);
});

it("keeps the device copy and reports the problem when the server delete fails", async () => {
  mocks.remove.mockResolvedValue({ ok: false });
  byLabel("Remove saved meal photo").props.onPress();
  await flush();
  expect(mocks.removeLocal).not.toHaveBeenCalled();
  expect(removed).not.toHaveBeenCalled();
  expect(
    find(render(), (node) => node.props?.accessibilityRole === "alert").props
      .children,
  ).toBe("Photo could not be removed. Try again.");
  mocks.remove.mockRejectedValue(new Error("offline"));
  byLabel("Remove saved meal photo").props.onPress();
  await flush();
  expect(mocks.removeLocal).not.toHaveBeenCalled();
});

it("removes a device-only photo without any request", async () => {
  hasServerCopy = false;
  byLabel("Remove saved meal photo").props.onPress();
  await flush();
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.removeLocal).toHaveBeenCalledTimes(1);
  expect(removed).toHaveBeenCalledTimes(1);
});

it("reports a device deletion failure and does not notify removal", async () => {
  hasServerCopy = false;
  mocks.removeLocal.mockReturnValue(false);
  byLabel("Remove saved meal photo").props.onPress();
  await flush();
  expect(removed).not.toHaveBeenCalled();
  expect(
    find(render(), (node) => node.props?.accessibilityRole === "alert").props
      .children,
  ).toBe("Photo could not be removed. Try again.");
});
