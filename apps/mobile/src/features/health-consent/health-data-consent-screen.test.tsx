import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [initial, vi.fn()],
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  View: "View",
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/components/legal-links", () => ({ LegalLinks: "LegalLinks" }));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  Icon: "Icon",
}));
vi.mock("@/constants/theme", () => ({
  MaxContentWidth: 800,
  MinTouchTarget: 44,
  PageGutter: 20,
  Radius: {},
  Spacing: {},
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/features/settings/account-data-card", () => ({
  AccountDataCard: "AccountDataCard",
}));

import {
  HEALTH_DATA_CONSENT_LABEL,
  HealthDataConsentScreen,
} from "./health-data-consent-screen";

function flatten(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (!node || typeof node !== "object") return [];
  if (typeof node.type === "function") return flatten(node.type(node.props));
  return [node, ...flatten(node.props?.children)];
}

const render = (withdrawn = false) =>
  flatten(
    HealthDataConsentScreen({
      withdrawn,
      onAgree: async () => null,
      onSignOut: () => undefined,
    }),
  );

describe("health data consent step (PRIV-01)", () => {
  it("starts with an unticked, separate checkbox and cannot continue until ticked", () => {
    const nodes = render();
    const checkbox = nodes.find(
      (node) => node.props?.accessibilityRole === "checkbox",
    );
    expect(checkbox.props.accessibilityState).toEqual({ checked: false });
    expect(checkbox.props.accessibilityLabel).toBe(HEALTH_DATA_CONSENT_LABEL);
    expect(HEALTH_DATA_CONSENT_LABEL).not.toMatch(/terms/i);
    const proceed = nodes.find(
      (node) => node.type === "Button" && node.props.label === "Continue",
    );
    expect(proceed.props.disabled).toBe(true);
  });

  it("explains what is stored and why before the choice, and links the policy and Terms", () => {
    const nodes = render();
    const text = nodes
      .filter((node) => typeof node.props?.children === "string")
      .map((node) => node.props.children as string);
    expect(text.join(" ")).toMatch(/weight and body measurements/);
    expect(text).toContain("Why");
    expect(nodes.some((node) => node.type === "LegalLinks")).toBe(true);
  });

  it("offers export and deletion whether or not the user agrees (PRIV-01 review)", () => {
    const label = "Export or delete my data";
    expect(render(false).some((node) => node.props?.label === label)).toBe(
      true,
    );
    expect(render(true).some((node) => node.props?.label === label)).toBe(true);
  });
});
