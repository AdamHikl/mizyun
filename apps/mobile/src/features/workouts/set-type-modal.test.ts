import { describe, expect, it, vi } from "vitest";
import { SET_TYPE_OPTIONS, SetTypeModal } from "./set-type-modal";

vi.mock("react-native", () => ({
  Modal: "Modal",
  Platform: {
    select: (options: Record<string, unknown>) =>
      options.ios ?? options.default,
  },
  Pressable: "Pressable",
  StyleSheet: {
    create: (styles: unknown) => styles,
    hairlineWidth: 1,
  },
  View: "View",
}));

vi.mock("@/components/ui", () => ({
  Button: "Button",
  Card: "Card",
  Chip: "Chip",
  FormField: "FormField",
  FormTextInput: "FormTextInput",
  Icon: "Icon",
  IconButton: "IconButton",
  ListGroup: "ListGroup",
  Notice: "Notice",
  SectionHeader: "SectionHeader",
}));

vi.mock("@/components/themed-text", () => ({
  ThemedText: "ThemedText",
}));

vi.mock("@/components/themed-view", () => ({
  ThemedView: "ThemedView",
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    backgroundElement: "#1E1E24",
    border: "rgba(255, 255, 255, 0.1)",
    text: "#FFFFFF",
    textSecondary: "#8A8D91",
  }),
}));

describe("SET_TYPE_OPTIONS", () => {
  it("includes all 4 workout set types with accurate metadata", () => {
    const types = SET_TYPE_OPTIONS.map((o) => o.type);
    expect(types).toEqual(["normal", "warmup", "failure", "drop"]);

    const warmup = SET_TYPE_OPTIONS.find((o) => o.type === "warmup");
    expect(warmup?.badge).toBe("W");
    expect(warmup?.tone).toBe("warning");

    const failure = SET_TYPE_OPTIONS.find((o) => o.type === "failure");
    expect(failure?.badge).toBe("F");
    expect(failure?.tone).toBe("danger");

    const drop = SET_TYPE_OPTIONS.find((o) => o.type === "drop");
    expect(drop?.badge).toBe("D");
    expect(drop?.tone).toBe("fat");
  });
});

describe("SetTypeModal component", () => {
  it("exports a valid React component function", () => {
    expect(typeof SetTypeModal).toBe("function");
  });
});
