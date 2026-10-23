import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ data: undefined as any, run: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
}));
vi.mock("react-native", () => ({ Text: "Text" }));
vi.mock("expo-router", () => ({ useFocusEffect: () => {} }));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "owner" } } }),
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("../ui", () => ({
  CommunityPage: "Page",
  CommunitySection: "Section",
  CommunityRow: "Row",
}));
vi.mock("./form", () => ({ ExpansionButton: "Button" }));
vi.mock("./use-expansion-command", () => ({
  useExpansionCommand: () => ({
    data: mocks.data,
    error: null,
    busy: false,
    run: mocks.run,
  }),
}));
vi.mock("../state/read-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/read-cache")>()),
  invalidateCommunityReads: vi.fn(),
}));
import { CommunityExpansionsScreen } from "./screen";
function rows(): any[] {
  const outer = CommunityExpansionsScreen();
  const tree = (outer.type as any)(outer.props);
  const walk = (node: any): any[] =>
    Array.isArray(node)
      ? node.flatMap(walk)
      : node && typeof node === "object"
        ? [node, ...walk(node.props?.children)]
        : [];
  return walk(tree).filter((node) => node.type === "Row");
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.data = undefined;
});
describe("contextual Spaces directory", () => {
  it("preserves every Space management route with truthful unconfirmed availability", () => {
    const destinations = rows();
    expect(destinations.map((row) => row.props.href)).toEqual([
      "/community/groups",
      "/community/challenges",
      "/community/routines",
      "/community/media",
      "/community/comments",
      "/community/discover",
    ]);
    expect(
      destinations.every((row) =>
        row.props.description.endsWith("Availability unconfirmed"),
      ),
    ).toBe(true);
  });
  it("keeps management reachable when sharing is paused without marking it available", () => {
    mocks.data = [{ feature: "media", enabled: false }];
    const media = rows().find((row) => row.props.href === "/community/media");
    expect(media.props.description).toContain("Sharing paused");
    expect(media.props.disabled).not.toBe(true);
  });
});
