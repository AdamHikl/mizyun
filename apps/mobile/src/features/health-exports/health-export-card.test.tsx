import React from "react";
// @ts-expect-error React DOM runtime is installed; mobile has no server-rendering type declarations.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthExportOutboxState } from "./export-outbox";

const controls = vi.hoisted(() => ({
  variant: "dev",
  token: "synthetic-token" as string | null,
  platform: "ios",
  state: null as unknown as HealthExportOutboxState,
  presses: new Map<string, { run: () => void; disabled: boolean }>(),
  enable: vi.fn(async () => undefined),
  disable: vi.fn(),
  retry: vi.fn(async () => undefined),
}));
vi.mock("./native-writer", () => ({
  healthExportOutbox: {
    subscribe: () => () => undefined,
    getSnapshot: () => controls.state,
    enable: controls.enable,
    disable: controls.disable,
    retry: controls.retry,
  },
}));
vi.mock("@/composition/app-variant", () => ({
  getAppVariant: () => controls.variant,
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: controls.token
      ? { accessToken: controls.token, user: { id: "synthetic-owner" } }
      : null,
  }),
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ primary: "#059669", border: "#DDD" }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return controls.platform;
    },
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
    accessibilityLabel: string;
    disabled: boolean;
  }) => {
    controls.presses.set(accessibilityLabel, { run: onPress, disabled });
    return (
      <button disabled={disabled} aria-label={accessibilityLabel}>
        {children}
      </button>
    );
  },
}));
import { HealthExportCard } from "./health-export-card";

beforeEach(() => {
  controls.variant = "dev";
  controls.token = "synthetic-token";
  controls.platform = "ios";
  controls.presses.clear();
  vi.clearAllMocks();
  controls.state = {
    phase: "disabled",
    enabled: { nutrition: false, workout: false },
    pending: { nutrition: 0, workout: 0 },
    errorCode: null,
  };
});

describe("Dev health export controls", () => {
  it("explains exact scope and retention without enabling or retrying on render", () => {
    const html = renderToStaticMarkup(<HealthExportCard />);
    expect(html).toContain("Apple Health");
    expect(html).toContain("explicitly confirmed manual Mizyun meals");
    expect(html).toContain(
      "AI estimates, imported records, date-only records and historical saves",
    );
    expect(html).toContain("Confirm your choices again each app");
    expect(html).toContain("40 exported records");
    expect(html).toContain(
      "remain when exports are off or your Mizyun account is deleted",
    );
    expect(controls.enable).not.toHaveBeenCalled();
    expect(controls.retry).not.toHaveBeenCalled();
  });
  it.each([
    ["nutrition", "nutrition"],
    ["workout", "workouts"],
  ] as const)(
    "enables only the explicitly chosen %s category",
    (category, label) => {
      renderToStaticMarkup(<HealthExportCard />);
      controls.presses.get(`Enable ${label} exports`)!.run();
      expect(controls.enable).toHaveBeenCalledExactlyOnceWith(category);
      expect(controls.retry).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["production", "synthetic-token"],
    ["dev", null],
    ["dev", "preview-token"],
  ])("blocks controls for %s with token %s", (variant, token) => {
    controls.variant = variant;
    controls.token = token;
    controls.state.enabled = { nutrition: true, workout: true };
    controls.state.pending = { nutrition: 2, workout: 3 };
    const html = renderToStaticMarkup(<HealthExportCard />);
    expect(html).toContain("disabled in Production and app previews");
    expect(controls.presses.size).toBe(0);
    expect(controls.enable).not.toHaveBeenCalled();
    expect(controls.retry).not.toHaveBeenCalled();
  });
  it("shows separate pending counts and retries only the enabled chosen category", () => {
    controls.state.enabled = { nutrition: true, workout: false };
    controls.state.pending = { nutrition: 2, workout: 1 };
    controls.state.phase = "partial";
    const html = renderToStaticMarkup(<HealthExportCard />);
    expect(html).toContain("2 pending records");
    expect(html).toContain("1 pending record");
    expect(html).toContain("Some export components are incomplete");
    controls.presses.get("Retry pending nutrition exports")!.run();
    expect(controls.retry).toHaveBeenCalledExactlyOnceWith("nutrition");
    expect(
      controls.presses.get("Retry pending workouts exports")!.disabled,
    ).toBe(true);
    controls.presses.get("Retry pending workouts exports")!.run();
    expect(controls.retry).toHaveBeenCalledTimes(1);
    controls.presses.get("Turn off nutrition exports")!.run();
    expect(controls.disable).toHaveBeenCalledExactlyOnceWith("nutrition");
  });
  it("skips disabled and duplicate enable controls even if their handler is called", () => {
    controls.state.enabled = { nutrition: true, workout: false };
    renderToStaticMarkup(<HealthExportCard />);
    controls.presses.get("Enable nutrition exports")!.run();
    controls.presses.get("Turn off workouts exports")!.run();
    expect(controls.enable).not.toHaveBeenCalled();
    expect(controls.disable).not.toHaveBeenCalled();
  });
  it("blocks new authorization and retry while writing but allows stopping an enabled category", () => {
    controls.state.phase = "writing";
    controls.state.enabled = { nutrition: true, workout: false };
    controls.state.pending = { nutrition: 1, workout: 0 };
    renderToStaticMarkup(<HealthExportCard />);
    controls.presses.get("Enable workouts exports")!.run();
    controls.presses.get("Retry pending nutrition exports")!.run();
    controls.presses.get("Turn off nutrition exports")!.run();
    expect(controls.enable).not.toHaveBeenCalled();
    expect(controls.retry).not.toHaveBeenCalled();
    expect(controls.disable).toHaveBeenCalledExactlyOnceWith("nutrition");
  });
  it.each([
    ["permission_required", "Write access was not granted"],
    ["unavailable", "unavailable on this device or app build"],
    ["install_required", "Install or update Health Connect"],
    ["error", "An export could not be confirmed"],
  ] as const)("renders actionable %s status", (phase, message) => {
    controls.state.phase = phase;
    controls.platform = "android";
    const html = renderToStaticMarkup(<HealthExportCard />);
    expect(html).toContain(message);
    expect(html).toContain("Health Connect");
    expect(controls.enable).not.toHaveBeenCalled();
  });
  it("explains full capacity without disclosing internal errors or record payloads", () => {
    controls.state.phase = "error";
    controls.state.errorCode = "storage_full";
    const html = renderToStaticMarkup(<HealthExportCard />);
    expect(html).toContain("Dev export limit is full");
    expect(html).not.toContain("storage_full");
  });
});
