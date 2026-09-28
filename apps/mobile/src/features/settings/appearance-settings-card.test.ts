import { describe, expect, it, vi, beforeEach } from "vitest";

let mockThemePreference = "auto";
const mockSetPreference = vi.fn().mockImplementation(async (pref: string) => {
  mockThemePreference = pref;
  return true;
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: any) => [initial, vi.fn()],
    useCallback: (fn: any) => fn,
  };
});

vi.mock("react-native", () => ({
  Platform: {
    select: (options: Record<string, unknown>) =>
      options.ios ?? options.default,
  },
  Pressable: "Pressable",
  StyleSheet: {
    create: (styles: unknown) => styles,
  },
  View: "View",
}));

vi.mock("@/components/themed-text", () => ({
  ThemedText: "ThemedText",
}));

vi.mock("@/components/themed-view", () => ({
  ThemedView: "ThemedView",
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({
    background: "#F8FAF9",
    backgroundElement: "#EEF3F0",
    backgroundSelected: "#DCE7E1",
    border: "#CBD5E1",
    primary: "#059669",
    text: "#0F172A",
    textSecondary: "#64748B",
  }),
}));

vi.mock("@/features/theme/theme-context", () => ({
  useThemePreference: () => ({
    preference: mockThemePreference,
    resolvedScheme: mockThemePreference === "dark" ? "dark" : "light",
    setPreference: mockSetPreference,
    isReady: true,
  }),
}));

import { AppearanceSettingsCard } from "./appearance-settings-card";

describe("AppearanceSettingsCard", () => {
  beforeEach(() => {
    mockThemePreference = "auto";
    mockSetPreference.mockClear();
  });

  it("renders without error", () => {
    const element = AppearanceSettingsCard();
    expect(element).toBeDefined();
    expect(element.type).toBe("ThemedView");
  });

  it("includes all 3 theme options: auto, light, dark", () => {
    const element = AppearanceSettingsCard();
    const children = element.props.children;
    const optionsListView = children[1];
    expect(optionsListView).toBeDefined();
    const options = optionsListView.props.children;
    expect(options).toHaveLength(3);

    const keys = options.map((opt: any) => opt.key);
    expect(keys).toEqual(["auto", "light", "dark"]);
  });

  it("marks the active option as selected", () => {
    mockThemePreference = "dark";
    const element = AppearanceSettingsCard();
    const optionsListView = element.props.children[1];
    const options = optionsListView.props.children;

    const darkOption = options.find((opt: any) => opt.key === "dark");
    expect(darkOption.props.accessibilityState.selected).toBe(true);

    const lightOption = options.find((opt: any) => opt.key === "light");
    expect(lightOption.props.accessibilityState.selected).toBe(false);

    const autoOption = options.find((opt: any) => opt.key === "auto");
    expect(autoOption.props.accessibilityState.selected).toBe(false);
  });

  it("calls setPreference when an option is pressed", async () => {
    const element = AppearanceSettingsCard();
    const optionsListView = element.props.children[1];
    const options = optionsListView.props.children;

    const lightOption = options.find((opt: any) => opt.key === "light");
    await lightOption.props.onPress();

    expect(mockSetPreference).toHaveBeenCalledWith("light");
  });
});
