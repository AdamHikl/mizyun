import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  session: { user: { id: "account-a" }, accessToken: "token-a" } as {
    user: { id: string };
    accessToken: string;
  } | null,
  profile: { displayName: "Test" } as { displayName: string } | null,
  onboarding: false,
  workout: null as object | null,
  pathname: "/",
  ref: { current: null as string | null },
  local: vi.fn(),
  remote: vi.fn(),
  workouts: vi.fn(),
  push: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useCallback: (fn: unknown) => fn,
  useRef: () => mocks.ref,
}));
vi.mock("expo-router", () => ({
  router: { push: mocks.push },
  usePathname: () => mocks.pathname,
}));
vi.mock("@/features/analytics", () => ({
  AnalyticsConsentReminder: "Reminder",
}));
vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    session: mocks.session,
    profile: mocks.profile,
    isOnboardingActive: mocks.onboarding,
  }),
}));
vi.mock("@/features/workouts", () => ({
  findIncompleteWorkout: (workouts: { completedAt: string | null }[]) =>
    workouts.find((workout) => workout.completedAt === null) ?? null,
  useActiveWorkout: () => ({ activeWorkout: mocks.workout }),
}));
vi.mock("./api-client", () => ({ apiClient: { request: mocks.workouts } }));
vi.mock("./analytics-client", () => ({
  analyticsClient: { getConsent: mocks.local },
  createApiTransport: () => ({ getConsent: mocks.remote }),
}));
import { AnalyticsConsentReminderBridge } from "./analytics-consent-reminder-bridge";
const render = () => AnalyticsConsentReminderBridge() as ReactElement<any>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { user: { id: "account-a" }, accessToken: "token-a" };
  mocks.profile = { displayName: "Test" };
  mocks.onboarding = false;
  mocks.workout = null;
  mocks.pathname = "/";
  mocks.local.mockResolvedValue("unknown");
  mocks.workouts.mockResolvedValue({ ok: true, value: { workouts: [] } });
  mocks.remote.mockResolvedValue({
    ok: true,
    data: { granted: false, revision: 0 },
  });
});

describe("analytics reminder composition boundary", () => {
  it.each(["failed", "active"])(
    "suppresses unknown provider state after a %s workout read",
    async (outcome) => {
      mocks.workouts.mockResolvedValue(
        outcome === "failed"
          ? { ok: false }
          : { ok: true, value: { workouts: [{ completedAt: null }] } },
      );
      expect(render().props.canPrompt).toBe(true);
      expect(await render().props.readConsent()).toBe(null);
      expect(mocks.remote).not.toHaveBeenCalled();
    },
  );
  it("waits for a delayed workout hydration before allowing a reminder", async () => {
    let release!: (value: unknown) => void;
    mocks.workouts.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const pending = render().props.readConsent();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.remote).not.toHaveBeenCalled();
    release({ ok: true, value: { workouts: [] } });
    expect(await pending).toBe("unknown");
  });
  it("opens the real analytics controls from an eligible Home prompt", async () => {
    const tree = render();
    expect(tree.props.canPrompt).toBe(true);
    expect(await tree.props.readConsent()).toBe("unknown");
    tree.props.openSettings();
    expect(mocks.push).toHaveBeenCalledWith("/account-settings/analytics");
  });

  it.each([
    "signed-out",
    "preview",
    "onboarding",
    "no-profile",
    "workout",
    "other-route",
  ])("suppresses presentation for %s", (boundary) => {
    if (boundary === "signed-out") mocks.session = null;
    if (boundary === "preview") mocks.session!.accessToken = "preview-token";
    if (boundary === "onboarding") mocks.onboarding = true;
    if (boundary === "no-profile") mocks.profile = null;
    if (boundary === "workout") mocks.workout = { id: "test-workout" };
    if (boundary === "other-route") mocks.pathname = "/log-meal";
    expect(render().props.canPrompt).toBe(false);
  });

  it.each(["denied", "granted"])(
    "honors local %s including pending refusal",
    async (consent) => {
      mocks.local.mockResolvedValue(consent);
      expect(await render().props.readConsent()).toBe(consent);
      expect(mocks.remote).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ ok: false }, null],
    [{ ok: true, data: { granted: true, revision: 1 } }, "granted"],
    [{ ok: true, data: { granted: false, revision: 1 } }, "denied"],
  ])(
    "never interprets missing or decided remote consent as unknown",
    async (response, expected) => {
      mocks.remote.mockResolvedValue(response);
      expect(await render().props.readConsent()).toBe(expected);
    },
  );

  it("discards a delayed A consent response after account switch", async () => {
    let release!: (value: unknown) => void;
    mocks.remote.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const pending = render().props.readConsent();
    await Promise.resolve();
    await Promise.resolve();
    mocks.session = { user: { id: "account-b" }, accessToken: "token-b" };
    render();
    release({ ok: true, data: { granted: false, revision: 0 } });
    expect(await pending).toBe(null);
  });

  it("does not start a remote read after sign-out during a local read", async () => {
    let release!: (value: unknown) => void;
    mocks.local.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const pending = render().props.readConsent();
    mocks.session = null;
    render();
    release("unknown");
    expect(await pending).toBe(null);
    expect(mocks.remote).not.toHaveBeenCalled();
  });
});
