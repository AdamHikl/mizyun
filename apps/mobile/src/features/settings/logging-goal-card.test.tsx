import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cells: [] as any[],
  index: 0,
  effects: [] as (() => unknown)[],
  load: vi.fn(),
  save: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const i = mocks.index++;
    if (!(i in mocks.cells)) mocks.cells[i] = initial;
    return [
      mocks.cells[i],
      (next: any) => {
        mocks.cells[i] =
          typeof next === "function" ? next(mocks.cells[i]) : next;
      },
    ];
  },
  useRef: (initial: any) => {
    const i = mocks.index++;
    if (!(i in mocks.cells)) mocks.cells[i] = { current: initial };
    return mocks.cells[i];
  },
  useEffect: (fn: () => unknown, deps: unknown[]) => {
    const i = mocks.index++;
    const prior = mocks.cells[i];
    if (
      !prior ||
      prior.some((v: unknown, j: number) => !Object.is(v, deps[j]))
    ) {
      mocks.cells[i] = deps;
      mocks.effects.push(fn);
    }
  },
}));
vi.mock("react-native", () => ({
  StyleSheet: { create: (value: unknown) => value },
  Switch: "Switch",
  View: "View",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/ui", () => ({
  Chip: "Chip",
  ListGroup: "ListGroup",
  ListRow: "ListRow",
  SectionHeader: "SectionHeader",
}));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("@/features/dashboard/logging-consistency-preferences", () => ({
  DEFAULT_LOGGING_CONSISTENCY_PREFERENCES: { weeklyGoal: 5, hidden: false },
  loadLoggingConsistencyPreferences: mocks.load,
  saveLoggingConsistencyPreferences: mocks.save,
}));

import { LoggingGoalCard } from "./logging-goal-card";

function findAll(node: any, predicate: (n: any) => boolean, out: any[] = []) {
  if (Array.isArray(node)) node.forEach((c) => findAll(c, predicate, out));
  else if (node && typeof node === "object") {
    if (predicate(node)) out.push(node);
    findAll(node.props?.children, predicate, out);
    findAll(node.props?.trailing, predicate, out);
  }
  return out;
}
const byLabel = (tree: any, label: string) =>
  findAll(tree, (n) => n.props?.accessibilityLabel === label)[0];
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const render = () => {
  mocks.index = 0;
  return LoggingGoalCard({ userId: "u1" });
};
async function open() {
  render();
  for (const effect of mocks.effects.splice(0)) effect();
  await settle();
  return render();
}

beforeEach(() => {
  mocks.cells = [];
  mocks.effects = [];
  mocks.load.mockReset().mockResolvedValue({ weeklyGoal: 5, hidden: false });
  mocks.save.mockReset().mockResolvedValue(true);
});

describe("LoggingGoalCard", () => {
  it("offers goals from 3 to 7 with the stored goal selected", async () => {
    const tree = await open();
    const chips = findAll(tree, (n) => n.type === "Chip");
    expect(chips.map((c) => c.props.label)).toEqual([
      "3 days",
      "4 days",
      "5 days",
      "6 days",
      "7 days",
    ]);
    expect(chips.filter((c) => c.props.selected)).toHaveLength(1);
    expect(byLabel(tree, "Log 5 days a week").props.selected).toBe(true);
    expect(byLabel(tree, "Show weekly logging card").props.value).toBe(true);
  });

  it("saves a changed goal for the signed-in user", async () => {
    let tree = await open();
    byLabel(tree, "Log 3 days a week").props.onPress();
    await settle();
    expect(mocks.save).toHaveBeenCalledWith("u1", {
      weeklyGoal: 3,
      hidden: false,
    });
    tree = render();
    expect(byLabel(tree, "Log 3 days a week").props.selected).toBe(true);
  });

  it("hides the card and persists it", async () => {
    let tree = await open();
    byLabel(tree, "Show weekly logging card").props.onValueChange(false);
    await settle();
    expect(mocks.save).toHaveBeenCalledWith("u1", {
      weeklyGoal: 5,
      hidden: true,
    });
    tree = render();
    expect(byLabel(tree, "Show weekly logging card").props.value).toBe(false);
  });

  it("restores the previous value when saving fails", async () => {
    mocks.save.mockResolvedValue(false);
    let tree = await open();
    byLabel(tree, "Log 7 days a week").props.onPress();
    await settle();
    tree = render();
    expect(byLabel(tree, "Log 5 days a week").props.selected).toBe(true);
    expect(JSON.stringify(tree)).toContain("Couldn't save");
  });
});
