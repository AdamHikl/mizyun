import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  ListGroup: "ListGroup",
  ListRow: "ListRow",
  Notice: "Notice",
}));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("react-native", () => ({
  View: "View",
  StyleSheet: { create: (value: unknown) => value },
}));

import {
  WeeklyReviewPanel,
  type WeeklyReviewPanelProps,
} from "./weekly-review-panel";
import { proposalFixture, reviewFixture } from "./fixtures.test-util";

type Node = { type?: unknown; props?: Record<string, unknown> } | unknown;

const walk = (
  node: Node,
  visit: (n: { type?: unknown; props: Record<string, unknown> }) => void,
): void => {
  if (Array.isArray(node)) return void node.forEach((n) => walk(n, visit));
  if (!node || typeof node !== "object") return;
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.props) {
    visit({ type: el.type, props: el.props });
    walk(el.props.children as Node, visit);
  }
};

const render = (props: Partial<WeeklyReviewPanelProps>) =>
  WeeklyReviewPanel({
    snapshot: { review: reviewFixture(), proposal: proposalFixture() },
    unitSystem: "metric",
    submitting: null,
    message: null,
    outcome: null,
    onAccept: vi.fn(),
    onDecline: vi.fn(),
    ...props,
  });

const texts = (tree: Node): string => {
  const out: string[] = [];
  const collect = (n: Node): void => {
    if (typeof n === "string" || typeof n === "number") out.push(String(n));
    else if (Array.isArray(n)) n.forEach(collect);
    else if (n && typeof n === "object" && "props" in n) {
      const p = (n as { props: Record<string, unknown> }).props;
      for (const key of ["title", "subtitle", "value", "message", "label"]) {
        if (typeof p[key] === "string") out.push(p[key] as string);
      }
      collect(p.children as Node);
    }
  };
  collect(tree);
  return out.join(" | ");
};

const buttons = (tree: Node) => {
  const found: Array<Record<string, unknown>> = [];
  walk(tree, (n) => {
    if (n.type === "Button") found.push(n.props);
  });
  return found;
};

describe("WeeklyReviewPanel", () => {
  it("shows current -> proposed, delta, evidence and both decisions", () => {
    const tree = render({});
    const text = texts(tree);
    expect(text).toContain("2,350 kcal");
    expect(text).toContain("2,200 kcal");
    expect(text).toContain("−150 kcal");
    expect(text).toContain("6 of 7");
    expect(text).toContain("98%");
    expect(text).toContain("Based on this week's rate of weight change.");
    expect(text).toContain("more slowly than your mode's range");
    expect(buttons(tree).map((b) => b.label)).toEqual([
      "Accept new target",
      "Keep current target",
    ]);
  });

  it("disables both buttons while submitting so a double tap is ignored", () => {
    const tree = render({ submitting: "accept" });
    const all = buttons(tree);
    expect(all.every((b) => b.disabled === true)).toBe(true);
    expect(all.find((b) => b.label === "Accept new target")?.loading).toBe(
      true,
    );
  });

  it("offers Later only when provided", () => {
    expect(buttons(render({ onLater: vi.fn() })).map((b) => b.label)).toContain(
      "Later",
    );
    expect(buttons(render({})).map((b) => b.label)).not.toContain("Later");
  });

  it("renders hold and insufficient_data with reasons and no buttons", () => {
    const hold = render({
      snapshot: {
        review: reviewFixture({
          status: "hold",
          reasons: ["within_band"],
          proposedTargetKcal: null,
          deltaKcal: 0,
        }),
        proposal: null,
      },
    });
    expect(buttons(hold)).toHaveLength(0);
    expect(texts(hold)).toContain("within the range for your mode");

    const thin = render({
      snapshot: {
        review: reviewFixture({
          status: "insufficient_data",
          reasons: ["too_few_logged_days"],
          proposedTargetKcal: null,
          deltaKcal: 0,
          loggedDays: 2,
          observedWeeklyChangeKg: null,
          observedWeeklyPercent: null,
        }),
        proposal: null,
      },
    });
    expect(buttons(thin)).toHaveLength(0);
    expect(texts(thin)).toContain("Too few days were logged");
    expect(texts(thin)).toContain("2 of 7");
  });

  it("hides buttons and states the outcome once decided", () => {
    const decided = render({
      snapshot: {
        review: reviewFixture(),
        proposal: proposalFixture({ status: "accepted" }),
      },
      outcome: "accept",
    });
    expect(buttons(decided)).toHaveLength(0);
    expect(texts(decided)).toContain("Target updated");
  });

  it("surfaces errors in a notice", () => {
    expect(
      texts(render({ message: "Your choice could not be saved. Try again." })),
    ).toContain("could not be saved");
  });

  it("leads with the delta and labels frozen numbers when no live target", () => {
    const text = texts(render({}));
    expect(text).toContain("\u2212150 kcal | /day");
    expect(text).toContain("At the time of the review");
  });

  it("derives the approximate result from the live target plus delta", () => {
    const text = texts(render({ liveTargetKcal: 2300 }));
    expect(text).toContain("about 2,150 kcal");
    expect(text).toContain("now 2,300 kcal");
    expect(text).not.toContain("At the time of the review");
  });

  it("explains recent_adjustment and any unknown future reason safely", () => {
    const tree = render({
      snapshot: {
        review: reviewFixture({
          status: "insufficient_data",
          reasons: ["recent_adjustment", "brand_new_code" as never],
          proposedTargetKcal: null,
          deltaKcal: 0,
        }),
        proposal: null,
      },
    });
    const text = texts(tree);
    expect(text).toContain("You accepted a change recently");
    expect(text).toContain("cannot describe");
  });
});
