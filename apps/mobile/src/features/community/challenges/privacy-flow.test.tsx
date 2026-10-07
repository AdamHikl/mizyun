import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  data: {} as any,
  run: vi.fn(),
  owner: true,
}));
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const index = hooks.index++;
    if (!(index in hooks.slots))
      hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], (value: any) => (hooks.slots[index] = value)];
  },
  useCallback: (callback: unknown) => callback,
}));
vi.mock("../ui", () => ({ CommunityPage: "CommunityPage" }));
vi.mock("react-native", () => ({
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "ios" },
  Text: "Text",
  View: "View",
  ScrollView: "ScrollView",
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: "Screen" },
  useFocusEffect: () => {},
  useLocalSearchParams: () => ({}),
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "owner" } } }),
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "black" }) }));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: vi.fn() },
}));
vi.mock("../community-presentation", () => ({ CommunityIntro: "Intro" }));
vi.mock("../safety/report-modal", () => ({ ReportModal: "Report" }));
vi.mock("../expansions", () => ({
  ExpansionButton: "Button",
  ExpansionInput: "Input",
  useExpansionCommand: () => ({
    data: mocks.data,
    busy: false,
    error: null,
    principal: "owner",
    run: mocks.run,
    capture: () => () => true,
  }),
}));
import { CommunityChallengesScreen } from "./screen";
const challengeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function challenge() {
  return {
    id: challengeId,
    title: mocks.owner ? "My goal" : "Challenge you joined",
    timezone: "UTC",
    joined: false,
    isOwner: mocks.owner,
    canceled: false,
    participants: 0,
    teamProgress: null,
    myProgress: 1,
    days: [{ day: "2026-10-01", kind: "rest", valid: true }],
  };
}
function render(): any {
  hooks.index = 0;
  const outer = CommunityChallengesScreen();
  return (outer.type as any)(outer.props);
}
function nodes(node: any): any[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
}
function button(tree: any, label: string): any {
  return nodes(tree).find(
    (node) => node.type === "Button" && node.props.label === label,
  );
}
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
beforeEach(() => {
  hooks.slots = [];
  mocks.data = {};
  mocks.owner = true;
  vi.clearAllMocks();
  mocks.run.mockImplementation(async (command) => {
    // Model a growth freeze: ordinary reads and engagement remain unavailable.
    if (
      ![
        "listMine",
        "getMine",
        "cancel",
        "leave",
        "removeContribution",
      ].includes(command.operation)
    )
      throw new Error("Growth is paused");
    if (command.operation === "listMine")
      mocks.data = { challenges: [challenge()], nextCursor: challengeId };
    else if (command.operation === "getMine")
      mocks.data = { challenge: challenge() };
    return mocks.data;
  });
});
async function openMine() {
  button(render(), "Manage my challenges").props.onPress();
  await settle();
  button(
    render(),
    mocks.owner ? "My goal" : "Challenge you joined",
  ).props.onPress();
  await settle();
  expect(mocks.run).toHaveBeenCalledWith({
    operation: "getMine",
    id: challengeId,
  });
  return render();
}
describe("challenge privacy during growth freezes", () => {
  it("opens owner management without a group link and cancels through the owned read", async () => {
    const tree = await openMine();
    button(tree, "Cancel challenge").props.onPress();
    await settle();
    expect(mocks.run).toHaveBeenCalledWith({
      operation: "cancel",
      id: challengeId,
    });
    expect(mocks.run.mock.calls.at(-1)![0]).toEqual({
      operation: "getMine",
      id: challengeId,
    });
  });
  it("keeps joined-challenge leave and own declaration removal accessible after access is revoked", async () => {
    mocks.owner = false;
    const tree = await openMine();
    expect(button(tree, "Cancel challenge")).toBeUndefined();
    button(tree, "Remove declaration for 2026-10-01").props.onPress();
    await settle();
    expect(mocks.run).toHaveBeenCalledWith({
      operation: "removeContribution",
      id: challengeId,
      day: "2026-10-01",
    });
    button(tree, "Leave and remove my declarations").props.onPress();
    await settle();
    expect(mocks.run).toHaveBeenCalledWith({
      operation: "leave",
      id: challengeId,
    });
    expect(mocks.run.mock.calls.at(-1)![0]).toEqual({
      operation: "getMine",
      id: challengeId,
    });
  });
  it("keeps a failed cancellation visible instead of immediately refreshing over it", async () => {
    const tree = await openMine();
    mocks.run.mockClear();
    mocks.run.mockResolvedValueOnce(null);
    button(tree, "Cancel challenge").props.onPress();
    await settle();
    expect(mocks.run.mock.calls.map(([command]) => command.operation)).toEqual([
      "cancel",
    ]);
  });
  it("paginates own associations with the server cursor during a freeze", async () => {
    button(render(), "Manage my challenges").props.onPress();
    await settle();
    button(render(), "Next page of my challenges").props.onPress();
    await settle();
    expect(mocks.run).toHaveBeenCalledWith({
      operation: "listMine",
      after: challengeId,
    });
  });
});
