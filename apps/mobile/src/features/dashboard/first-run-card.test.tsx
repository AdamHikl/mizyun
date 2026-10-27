import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  slots: [] as unknown[],
  index: 0,
  completeFirstRun: vi.fn(),
  recordAcquisitionSource: vi.fn(),
  request: vi.fn(),
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
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
}));
vi.mock("react-native", () => ({
  StyleSheet: { create: (value: unknown) => value },
  View: "View",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  ChoiceChip: "ChoiceChip",
  ChoiceGroup: "ChoiceGroup",
  ListGroup: "ListGroup",
  ListRow: "ListRow",
}));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("@/composition/analytics-client", () => ({
  activationMilestones: {
    completeFirstRun: mocks.completeFirstRun,
    recordAcquisitionSource: mocks.recordAcquisitionSource,
  },
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: mocks.request },
}));
vi.mock("@/features/analytics/analytics-consent-prompt", () => ({
  AnalyticsConsentPrompt: "AnalyticsConsentPrompt",
}));

import { FirstRunCard, firstLogOptions } from "./first-run-card";

type Node = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

function render(props: Partial<Parameters<typeof FirstRunCard>[0]> = {}) {
  mocks.index = 0;
  const handlers = {
    onChoose: vi.fn(),
    onUnitsSaved: vi.fn(),
    onDone: vi.fn(),
  };
  const tree = FirstRunCard({
    owner: "owner-a",
    unitSystem: "metric",
    boulderingEnabled: true,
    ...handlers,
    ...props,
  }) as unknown as Node;
  return { tree, ...handlers };
}

function findAll(node: unknown, type: string): Node[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, type));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Node;
  return [
    ...(element.type === type ? [element] : []),
    ...findAll(element.props.children, type),
  ];
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mocks.slots = [];
  mocks.completeFirstRun.mockReset().mockResolvedValue(undefined);
  mocks.recordAcquisitionSource.mockReset().mockResolvedValue(true);
  mocks.request.mockReset().mockResolvedValue({ ok: true });
});

describe("first-run card", () => {
  it("offers climbing first, then workout, meal and weight in one tap each", async () => {
    const { tree, onChoose, onDone } = render();
    const rows = findAll(tree, "ListRow");
    expect(rows.map((row) => row.props.title)).toEqual([
      "A climbing session",
      "A workout",
      "A meal",
      "My weight",
    ]);
    (rows[0]!.props.onPress as () => void)();
    await flush();
    expect(mocks.completeFirstRun).toHaveBeenCalledWith(
      "owner-a",
      "climb",
      expect.any(Number),
    );
    expect(onDone).toHaveBeenCalledOnce();
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("climb");
  });

  it("hides climbing where bouldering is not enabled", () => {
    expect(firstLogOptions(false).map((option) => option.choice)).toEqual([
      "workout",
      "meal",
      "weight",
    ]);
  });

  it("lets the user look around without opening a capture", async () => {
    const { tree, onChoose, onDone } = render();
    const [explore] = findAll(tree, "Button");
    (explore!.props.onPress as () => void)();
    await flush();
    expect(mocks.completeFirstRun).toHaveBeenCalledWith(
      "owner-a",
      "explore",
      expect.any(Number),
    );
    expect(onDone).toHaveBeenCalledOnce();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("asks the source question only after analytics consent and sends the enum with the choice", async () => {
    let { tree } = render();
    expect(findAll(tree, "ChoiceChip").map((chip) => chip.props.label)).toEqual(
      ["Metric (kg, cm)", "Imperial (lb, in)"],
    );
    const [prompt] = findAll(tree, "AnalyticsConsentPrompt");
    (prompt!.props.onConsentChange as (value: string) => void)("granted");
    ({ tree } = render());
    const sources = findAll(tree, "ChoiceChip").slice(2);
    expect(sources.map((chip) => chip.props.label)).toContain(
      "Climbing gym or club",
    );
    expect(sources.map((chip) => chip.props.label)).not.toContain("Other…");
    const gym = sources.find(
      (chip) => chip.props.label === "Climbing gym or club",
    )!;
    (gym.props.onPress as () => void)();
    ({ tree } = render());
    (findAll(tree, "ListRow")[2]!.props.onPress as () => void)();
    await flush();
    expect(mocks.recordAcquisitionSource).toHaveBeenCalledExactlyOnceWith(
      "owner-a",
      "climbing_gym_or_club",
    );
  });

  it("does not send a source picked before consent was withdrawn", async () => {
    let { tree } = render();
    const [prompt] = findAll(tree, "AnalyticsConsentPrompt");
    const change = prompt!.props.onConsentChange as (value: string) => void;
    change("granted");
    ({ tree } = render());
    (findAll(tree, "ChoiceChip")[2]!.props.onPress as () => void)();
    change("denied");
    ({ tree } = render());
    expect(findAll(tree, "ChoiceChip")).toHaveLength(2);
    (findAll(tree, "ListRow")[1]!.props.onPress as () => void)();
    await flush();
    expect(mocks.recordAcquisitionSource).not.toHaveBeenCalled();
  });

  it("saves only the unit system and restores the choice on failure", async () => {
    let { tree, onUnitsSaved } = render();
    (findAll(tree, "ChoiceChip")[1]!.props.onPress as () => void)();
    await flush();
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: "/v1/profile",
        body: { unitSystem: "imperial" },
      }),
    );
    expect(onUnitsSaved).toHaveBeenCalledOnce();
    mocks.request.mockResolvedValueOnce({ ok: false });
    ({ tree } = render());
    (findAll(tree, "ChoiceChip")[0]!.props.onPress as () => void)();
    await flush();
    ({ tree } = render());
    expect(findAll(tree, "ChoiceChip")[1]!.props.selected).toBe(true);
  });
});
