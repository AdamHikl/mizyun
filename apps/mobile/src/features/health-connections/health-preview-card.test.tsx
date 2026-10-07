import React from "react";
// @ts-expect-error React DOM runtime is installed; mobile has no server-rendering type declarations.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HealthPreviewController,
  HealthPreviewReader,
} from "./health-preview-controller";

const controls = vi.hoisted(() => ({
  variant: "dev",
  controller: null as unknown as HealthPreviewController,
  presses: new Map<string, () => void>(),
}));
vi.mock("./health-preview-controller", async (original) => ({
  ...(await original<typeof import("./health-preview-controller")>()),
  HealthPreviewController: class {
    constructor() {
      return controls.controller;
    }
  },
}));
vi.mock("./native-reader", () => ({ nativeHealthPreviewReader: {} }));
vi.mock("@/composition/app-variant", () => ({
  getAppVariant: () => controls.variant,
}));
vi.mock("expo-router", () => ({ useFocusEffect: () => undefined }));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ primary: "#059669", border: "#DDD" }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: () => undefined }),
  },
  StyleSheet: { create: (style: unknown) => style },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    accessibilityLabel?: string;
    disabled?: boolean;
  }) => {
    if (accessibilityLabel) controls.presses.set(accessibilityLabel, onPress);
    return (
      <button disabled={disabled} aria-label={accessibilityLabel}>
        {children}
      </button>
    );
  },
}));
import { HealthPreviewCard } from "./health-preview-card";

const ready = {
  status: "ready" as const,
  records: [],
  nextPageToken: null,
  readAccess: "unknown" as const,
};
let reader: HealthPreviewReader;
beforeEach(async () => {
  controls.variant = "dev";
  controls.presses.clear();
  reader = {
    availabilityAsync: vi.fn(async () => ready),
    requestReadPermissionAsync: vi.fn(async () => ready),
    readPageAsync: vi.fn(async () => ({
      ...ready,
      records: [
        {
          kind: "weight",
          provider: "apple_health",
          externalId: "synthetic-weight",
          sourceAppId: "com.example.synthetic-scale",
          sourceAppName: "Synthetic Scale",
          sourceTimeZone: null,
          measuredAt: "2026-10-05T10:00:00.000Z",
          weightKg: 80,
        },
      ],
    })),
    invalidateAsync: vi.fn(async () => undefined),
  };
  const actual = await vi.importActual<
    typeof import("./health-preview-controller")
  >("./health-preview-controller");
  controls.controller = new actual.HealthPreviewController(
    reader,
    "apple_health",
    () => new Date("2026-10-06T12:00:00Z"),
  );
});

describe("Health preview user controls", () => {
  it("renders consent and separate category actions without prompting or reading", () => {
    const html = renderToStaticMarkup(
      <HealthPreviewCard userId="synthetic-owner" />,
    );
    expect(html).toContain("Preview weight");
    expect(html).toContain("Preview workouts");
    expect(html).toContain("health profile is yours");
    expect(html).toContain("Records stay in memory");
    expect(reader.requestReadPermissionAsync).not.toHaveBeenCalled();
    expect(reader.readPageAsync).not.toHaveBeenCalled();
  });
  it("chosen weight action requests only weight and shows provenance in selected units", async () => {
    renderToStaticMarkup(
      <HealthPreviewCard userId="synthetic-owner" unitSystem="imperial" />,
    );
    controls.presses.get("Preview weight from Health")!();
    await vi.waitFor(() =>
      expect(controls.controller.getSnapshot().phase).toBe("ready"),
    );
    expect(reader.requestReadPermissionAsync).toHaveBeenCalledExactlyOnceWith(
      "weight",
    );
    const html = renderToStaticMarkup(
      <HealthPreviewCard userId="synthetic-owner" unitSystem="imperial" />,
    );
    expect(html).toContain("176.4 lb");
    expect(html).toContain("Synthetic Scale");
    expect(html).toContain("source timezone unavailable");
    expect(html).toContain("Available history may be shorter");
  });
  it("Production cannot render read controls or invoke a native read", () => {
    controls.variant = "production";
    const html = renderToStaticMarkup(
      <HealthPreviewCard userId="synthetic-owner" />,
    );
    expect(html).toContain("not available in this build");
    expect(controls.presses.size).toBe(0);
    expect(reader.readPageAsync).not.toHaveBeenCalled();
  });
  it("empty iOS preview explains missing access without fabricating an observation", async () => {
    vi.mocked(reader.readPageAsync).mockResolvedValue(ready);
    await controls.controller.connect("weight");
    const html = renderToStaticMarkup(
      <HealthPreviewCard userId="synthetic-owner" />,
    );
    expect(html).toContain("does not confirm a zero or permission denial");
    expect(html).toContain("0 records");
    expect(html).not.toContain("Synthetic Scale");
  });
});
