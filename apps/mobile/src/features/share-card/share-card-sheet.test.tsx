import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  slots: [] as unknown[],
  index: 0,
  share: vi.fn(),
  release: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  track: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.slots))
      mocks.slots[index] =
        typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [
      mocks.slots[index],
      (next: unknown) => {
        mocks.slots[index] =
          typeof next === "function"
            ? (next as (value: unknown) => unknown)(mocks.slots[index])
            : next;
      },
    ];
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useMemo: (factory: () => unknown) => factory(),
  useEffect: () => undefined,
}));
vi.mock("react-native", () => ({
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
  Switch: "Switch",
  View: "View",
  useWindowDimensions: () => ({ width: 393, height: 852 }),
}));
vi.mock("@mizyun/core", () => ({ SHARE_CARD_GYM_NAME_MAX: 40 }));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  FormTextInput: "FormTextInput",
  IconButton: "IconButton",
  ListGroup: "ListGroup",
  ListRow: "ListRow",
  Notice: "Notice",
  SegmentedControl: "SegmentedControl",
}));
vi.mock("@/constants/theme", () => ({
  Radius: {},
  Spacing: { one: 4, two: 8, three: 16 },
}));
vi.mock("@/hooks/use-color-scheme", () => ({ useColorScheme: () => "light" }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ overlay: "#0008", background: "#fff" }),
}));
vi.mock("@/composition/analytics-client", () => ({
  analyticsClient: { track: mocks.track },
}));
vi.mock("./share-card-native", () => ({
  shareCardImage: mocks.share,
  releaseShareCardImage: mocks.release,
}));
vi.mock("./share-card-mark", () => ({ shareCardMark: () => null }));
vi.mock("./share-card-preferences", () => ({
  DEFAULT_SHARE_CARD_PREFERENCES: { rememberGymName: false },
  loadShareCardPreferences: mocks.load,
  saveShareCardPreferences: mocks.save,
}));
vi.mock("./share-card-view", () => ({
  SHARE_CARD_WIDTH: 320,
  ShareCardView: "ShareCardView",
}));

import { ShareCardSheet } from "./share-card-sheet";

type Node = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

/** Every element with the chain of element types above it. */
function walk(node: unknown, ancestors: unknown[] = []): [Node, unknown[]][] {
  if (Array.isArray(node))
    return node.flatMap((child) => walk(child, ancestors));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Node;
  return [
    [element, ancestors],
    ...walk(element.props.children, [...ancestors, element.type]),
  ];
}

function render(kind: "bouldering" | "workout" = "bouldering") {
  mocks.index = 0;
  const tree = ShareCardSheet({
    visible: true,
    userId: "synthetic-user",
    build: () => ({ kind }) as never,
    communityHandle: null,
    onClose: vi.fn(),
  });
  return walk(tree);
}

const shareButton = (elements: [Node, unknown[]][]) =>
  elements.find(([node]) => node.props.icon === "share")!;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mocks.slots = [];
  mocks.share.mockReset().mockResolvedValue({ kind: "shared" });
  mocks.release.mockReset().mockResolvedValue(undefined);
  mocks.track.mockReset().mockResolvedValue({ recorded: true });
});

describe("share-card sheet layout", () => {
  it("never nests the scroll area inside a touch-capturing Pressable", () => {
    const elements = render();
    const scrolls = elements.filter(([node]) => node.type === "ScrollView");
    expect(scrolls).toHaveLength(1);
    expect(scrolls[0]![1]).not.toContain("Pressable");
    const backdrop = elements.filter(([node]) => node.type === "Pressable");
    expect(backdrop).toHaveLength(1);
    expect(backdrop[0]![0].props.children).toBeUndefined();
  });

  it("pins Share image outside the scroll area", () => {
    const [button, ancestors] = shareButton(render());
    expect(button.props.label).toBe("Share image");
    expect(ancestors).not.toContain("ScrollView");
    expect(ancestors).not.toContain("Pressable");
  });
});

describe("share-card result analytics", () => {
  it.each([
    [{ kind: "shared" }, "share_sheet_shown"],
    [{ kind: "unavailable" }, "unavailable"],
    [{ kind: "failed", message: "Couldn't create the image." }, "failed"],
  ] as const)(
    "reports %o as the card kind and %s only",
    async (outcome, expected) => {
      mocks.share.mockResolvedValue(outcome);
      const [button] = shareButton(render("workout"));
      (button.props.onPress as () => void)();
      await flush();
      expect(mocks.track.mock.calls).toEqual([
        [
          {
            name: "share_card_result",
            properties: { card: "workout", outcome: expected },
          },
        ],
      ]);
    },
  );
});
