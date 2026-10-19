import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [initial, () => undefined],
}));
vi.mock("react-native", () => ({
  Modal: "Modal",
  Platform: { OS: "ios" },
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "ThemedText" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "ThemedView" }));
vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  Notice: "Notice",
}));
vi.mock("@/constants/theme", () => ({
  MaxContentWidth: 600,
  PageGutter: 16,
  Radius: { medium: 8 },
  Spacing: { one: 4, two: 8, three: 12, four: 16 },
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));

import { AiConsentModal } from "./ai-consent-modal";

const textOf = (node: unknown): string => {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const props = (node as { props?: { children?: unknown } }).props;
  return props ? textOf(props.children) : "";
};

describe("AI consent disclosure", () => {
  it("names every feature that sends data to the AI provider", () => {
    const text = textOf(
      AiConsentModal({
        visible: true,
        currentBirthYear: 1990,
        onConsent: () => undefined,
        onDecline: () => undefined,
      }),
    ).replace(/\s+/g, " ");
    for (const disclosure of [
      "Coach: your messages and photos, your recent conversation, saved Coach memories",
      "Meals: the photos and descriptions you submit for nutrition estimates, your country setting",
      "may also be looked up with Google Search",
      "A meal’s name is sent automatically to create an illustration",
      "your saved diet preferences, and the protein, carbs and fat left for today",
      "Log activity: the description you type and your phone’s current date and time",
    ]) {
      expect(text).toContain(disclosure);
    }
  });
});
