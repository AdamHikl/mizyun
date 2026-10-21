import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [initial, () => undefined],
}));
const platform = vi.hoisted(() => ({ OS: "ios" }));
vi.mock("react-native", () => ({
  Modal: "Modal",
  Platform: platform,
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
const variant = vi.hoisted(() => ({ stretchAi: true }));
vi.mock("@/composition/app-variant", () => ({
  isStretchAiEnabled: () => variant.stretchAi,
}));

import { AiConsentModal } from "./ai-consent-modal";

const textOf = (node: unknown): string => {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const props = (node as { props?: { children?: unknown } }).props;
  return props ? textOf(props.children) : "";
};

const render = (): string =>
  textOf(
    AiConsentModal({
      visible: true,
      currentBirthYear: 1990,
      onConsent: () => undefined,
      onDecline: () => undefined,
    }),
  ).replace(/\s+/g, " ");

describe("AI consent disclosure", () => {
  it("names both providers and which features use each", () => {
    const text = render();
    for (const disclosure of [
      "Anthropic (Claude): Coach chat, meal estimates from typed descriptions, changes you ask for to a meal draft, and filling in Log activity from a description.",
      "Google (Gemini API): meal and nutrition-label photos, including photos you send in Coach, ingredient photos, the cooking assistant, meal illustrations, and tailoring the evening stretch to your workout.",
      "Sent to Anthropic",
      "Sent to Google",
    ]) {
      expect(text).toContain(disclosure);
    }
    expect(text).not.toContain("powered by Google LLC");
    // The catalog recipe-ideas flow has no caller; the cooking assistant replaced it.
    expect(text).not.toContain("recipe ideas");
    expect(text).not.toContain("Recipe ideas");
    // The evening stretch is disclosed under Google, after "Sent to Google".
    expect(text.indexOf("Evening stretch:")).toBeGreaterThan(
      text.indexOf("Sent to Google"),
    );
  });

  it("names every feature that sends data to an AI provider", () => {
    const text = render();
    for (const disclosure of [
      "Coach: your messages, your recent conversation, saved Coach memories",
      "Meals: the descriptions you type for nutrition estimates, your country setting, and the current draft when you ask for changes",
      "may also be looked up on the web",
      "Log activity: the description you type and your phone’s current date and time",
      "Evening stretch: the names and set counts of the exercises you finished today and whether you ran or climbed",
      "at most twice a day",
      "Meal photos: the meal and nutrition-label photos you submit, in Log meal or Coach, any text you add with them, and your country setting",
      "Recipes: ingredient photos, your cooking assistant messages, the ingredients and ideas on screen",
      "Illustrations: a meal’s name, sent automatically to create an illustration",
    ]) {
      expect(text).toContain(disclosure);
    }
    // Typed descriptions no longer go to Google Search via Gemini.
    expect(text).not.toContain("Google Search");
  });

  it("states each provider's retention and training terms conservatively", () => {
    const text = render();
    expect(text).toContain(
      "Anthropic’s commercial terms say it does not train models on this data. It normally deletes it within 30 days, but may keep it longer to enforce its usage policy or where the law requires.",
    );
    expect(text).toContain(
      "Google may retain prompts, context, and output for abuse monitoring for up to 55 days.",
    );
    expect(text).toContain(
      "Mizyun does not promise that every submission is excluded from Google product improvement.",
    );
  });

  it("mentions on-device processing only on iOS", () => {
    const onDevice =
      "When Apple Intelligence is on and ready on your iPhone, Log activity first tries to fill in on the iPhone and sends the description to Anthropic only if that doesn’t work.";
    expect(render()).toContain(onDevice);
    platform.OS = "android";
    const android = render();
    platform.OS = "ios";
    expect(android).not.toContain("Apple Intelligence");
    expect(android).toContain("Anthropic (Claude)");
  });

  it("leaves the evening stretch out where the build does not tailor it", () => {
    variant.stretchAi = false;
    const text = render();
    variant.stretchAi = true;
    expect(text).not.toContain("Evening stretch");
    expect(text).not.toContain("evening stretch");
    expect(text).toContain("the cooking assistant, and meal illustrations.");
  });
});
