import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [initial, vi.fn()],
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
}));
vi.mock("react-native", () => ({
  Share: { share: vi.fn() },
  StyleSheet: { create: (styles: unknown) => styles },
  View: "View",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Card: "Card" }));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("@/composition/analytics-client", () => ({
  analyticsClient: {
    getConsent: vi.fn(),
    setConsent: vi.fn(),
    exportEvents: vi.fn(),
    clearEvents: vi.fn(),
  },
}));

import { AnalyticsCard } from "./analytics-card";

function flatten(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (!node || typeof node !== "object") return [];
  return [node, ...flatten(node.props?.children)];
}

describe("analytics consent presentation", () => {
  it("shows the full disclosure before any consent choice and weights choices equally", () => {
    const nodes = flatten(AnalyticsCard());
    const disclosure = nodes.findIndex(
      (node) =>
        typeof node.props?.children === "string" &&
        node.props.children.includes("linked to your account"),
    );
    const buttons = nodes.filter((node) => node.type === "Button");
    const firstButton = nodes.indexOf(buttons[0]);
    expect(disclosure).toBeGreaterThanOrEqual(0);
    expect(disclosure).toBeLessThan(firstButton);
    const allow = buttons.find((b) => /Allow|Enabled/.test(b.props.label));
    const deny = buttons.find((b) => b.props.label === "Disable and clear");
    expect(allow.props.variant).toBe(deny.props.variant);
    expect(["primary", "destructive"]).not.toContain(allow.props.variant);
  });
});
