import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  enabled: true,
  open: true,
  back: vi.fn(),
  canGoBack: true,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => [
    mocks.open,
    (value: boolean) => {
      mocks.open = value;
    },
  ],
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ back: mocks.back, canGoBack: () => mocks.canGoBack }),
}));
vi.mock("@/composition/app-variant", () => ({
  isBoulderingEnabled: () => mocks.enabled,
}));
vi.mock("./share-bouldering-modal", () => ({
  ShareBoulderingModal: "ShareBoulderingModal",
}));
vi.mock("./ui", () => ({
  CommunityButton: "CommunityButton",
  CommunityPage: "CommunityPage",
  CommunityState: "CommunityState",
}));
import {
  CommunityShareBoulderingScreen,
  shareableBoulderingSessionId,
} from "./share-bouldering-screen";

const SESSION = "00000000-0000-4000-8000-0000000000B1";
function findAll(node: any, type: string): any[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, type));
  return [
    ...(node.type === type ? [node] : []),
    ...findAll(node.props?.children, type),
  ];
}

beforeEach(() => {
  mocks.enabled = true;
  mocks.open = true;
  mocks.canGoBack = true;
  vi.clearAllMocks();
});

describe("share bouldering route", () => {
  it("accepts only a well-formed session id", () => {
    expect(shareableBoulderingSessionId(SESSION)).toBe(SESSION.toLowerCase());
    expect(shareableBoulderingSessionId([SESSION])).toBe(SESSION.toLowerCase());
    expect(shareableBoulderingSessionId("../meals")).toBeNull();
    expect(shareableBoulderingSessionId(undefined)).toBeNull();
  });
  it("opens the share sheet for the session and returns on dismiss", () => {
    const tree: any = CommunityShareBoulderingScreen({ sessionId: SESSION });
    const [modal] = findAll(tree, "ShareBoulderingModal");
    expect(modal.props.sessionId).toBe(SESSION.toLowerCase());
    modal.props.onDismiss();
    expect(mocks.open).toBe(false);
    expect(mocks.back).toHaveBeenCalledOnce();
  });
  it("never opens a preview when bouldering is disabled or the id is invalid", () => {
    mocks.enabled = false;
    let tree: any = CommunityShareBoulderingScreen({ sessionId: SESSION });
    expect(findAll(tree, "ShareBoulderingModal")).toHaveLength(0);
    expect(findAll(tree, "CommunityState")[0].props.title).toBe(
      "Bouldering isn't available",
    );
    mocks.enabled = true;
    tree = CommunityShareBoulderingScreen({ sessionId: "nope" });
    expect(findAll(tree, "ShareBoulderingModal")).toHaveLength(0);
    expect(findAll(tree, "CommunityState")[0].props.title).toBe(
      "Session not found",
    );
  });
});
