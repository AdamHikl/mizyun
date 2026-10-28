import { beforeEach, expect, it, vi } from "vitest";
import type { AuthSession } from "@mizyun/identity";
import type { UserId } from "@mizyun/core";

// REL-01: the provider saves the phone's zone after sign-in and when the app
// returns to the foreground in a different zone.
const mocks = vi.hoisted(() => ({
  subscribe: null as ((value: AuthSession | null) => void) | null,
  appState: null as ((state: string) => void) | null,
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
  zone: "America/Los_Angeles" as string | null,
  serverZone: "UTC",
  request: vi.fn(),
  saveCachedProfile: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (initial: unknown) =>
    (mocks.slots[mocks.index++] ??= { current: initial }),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.slots)) mocks.slots[index] = initial;
    return [
      mocks.slots[index],
      (next: unknown) => {
        mocks.slots[index] =
          typeof next === "function"
            ? (next as (value: unknown) => unknown)(mocks.slots[index])
            : next;
      },
    ];
  },
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void) => {
    mocks.effects.push(fn);
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_: string, listener: (state: string) => void) => {
      mocks.appState = listener;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("./profile-time-zone-sync", async (original) => ({
  ...(await original<typeof import("./profile-time-zone-sync")>()),
  readDeviceTimeZone: () => mocks.zone,
}));
vi.mock("@/features/meal-recipes/public-data", () => ({
  retireIngredientReviews: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/composition/first-meal-reminder-runtime", () => ({
  firstMealReminderLifecycle: {
    setOwner: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/composition/app-variant", () => ({ getAppVariant: () => "dev" }));
vi.mock("@/composition/analytics-client", () => ({
  analyticsClient: {
    resetLocalSession: vi.fn().mockResolvedValue(undefined),
    syncConsent: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/composition/auth-client", () => ({
  authClient: {
    status: () => ({ configured: true }),
    getSession: () => new Promise(() => {}),
    subscribe: (callback: (value: AuthSession | null) => void) => {
      mocks.subscribe = callback;
      return vi.fn();
    },
    signOut: vi.fn(),
  },
}));
vi.mock("@/composition/api-client", () => ({
  apiConfiguration: { configured: true },
  apiClient: { request: mocks.request },
}));
vi.mock("@/features/community/push", () => ({
  deregisterCommunityPush: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/community/state/read-cache", () => ({
  invalidateCommunityReads: vi.fn(),
  setCommunityReadPrincipal: vi.fn(),
}));
vi.mock("@/features/offline-cache/offline-cache-storage", () => ({
  loadCachedProfile: vi.fn().mockResolvedValue(null),
  saveCachedProfile: mocks.saveCachedProfile,
  purgeOfflineCache: vi.fn(),
}));
vi.mock("@/features/log-meal/public-data", () => ({
  forgetMealVisualMemory: vi.fn(),
  setMealPhotoPrincipal: vi.fn(),
}));
vi.mock("@/features/recurring-meals/public-data", () => ({
  setRecurringSuggestionOwner: vi.fn(),
}));
vi.mock("./auth-screen", () => ({ AuthScreen: "AuthScreen" }));
vi.mock("./auth-setup-screen", () => ({ AuthSetupScreen: "AuthSetupScreen" }));
vi.mock("./loading-screen", () => ({ LoadingScreen: "LoadingScreen" }));
vi.mock("./reset-password-screen", () => ({
  ResetPasswordScreen: "ResetPasswordScreen",
}));
vi.mock("@/features/onboarding/onboarding-screen", () => ({
  OnboardingScreen: "OnboardingScreen",
}));
vi.mock("@/features/health-consent/age-restricted-screen", () => ({
  AgeRestrictedScreen: "AgeRestrictedScreen",
}));
vi.mock("@/features/health-consent/consent-unavailable-screen", () => ({
  ConsentUnavailableScreen: "ConsentUnavailableScreen",
}));
vi.mock("@/features/health-consent/health-data-consent-screen", () => ({
  HealthDataConsentScreen: "HealthDataConsentScreen",
}));
vi.mock("@/features/health-consent/health-data-consent-context", () => ({
  HealthDataConsentProvider: "HealthDataConsentProvider",
  useHealthDataConsent: () => null,
}));
import { AuthProvider } from "./auth-context";

const USER = "00000000-0000-4000-8000-000000000001";
const serverProfile = (timezone: string) => ({ userId: USER, timezone });

const render = () => {
  mocks.index = 0;
  mocks.effects = [];
  return AuthProvider({ children: null });
};
const runEffects = () => mocks.effects.splice(0).forEach((effect) => effect());
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const puts = () =>
  mocks.request.mock.calls
    .map(([options]) => options)
    .filter((options) => options.method === "PUT");

const signIn = async () => {
  render();
  mocks.slots[2] = false; // Bootstrap has completed.
  render();
  runEffects();
  mocks.subscribe!({
    user: { id: USER as UserId },
    accessToken: "user-token",
  });
  await settle();
  // Re-render with the fetched profile so its effects see it.
  const tree = render();
  runEffects();
  await settle();
  return tree;
};

beforeEach(() => {
  mocks.slots = [];
  mocks.subscribe = null;
  mocks.appState = null;
  mocks.zone = "America/Los_Angeles";
  mocks.serverZone = "UTC";
  mocks.saveCachedProfile.mockReset();
  mocks.request.mockReset().mockImplementation(async (options) =>
    options.method === "PUT"
      ? {
          ok: true,
          value: { profile: serverProfile(options.body.timezone) },
        }
      : { ok: true, value: { profile: serverProfile(mocks.serverZone) } },
  );
});

it("saves the device zone after sign-in when the profile still reads UTC", async () => {
  await signIn();
  expect(puts()).toEqual([
    expect.objectContaining({
      path: "/v1/profile",
      body: { timezone: "America/Los_Angeles" },
    }),
  ]);
  expect(render().props.value.profile.timezone).toBe("America/Los_Angeles");
  expect(mocks.saveCachedProfile).toHaveBeenCalledWith(
    USER,
    serverProfile("America/Los_Angeles"),
  );
});

it("sends nothing when the saved zone already matches the device", async () => {
  mocks.serverZone = "America/Los_Angeles";
  await signIn();
  expect(puts()).toEqual([]);
});

it("saves a changed zone when the app returns to the foreground", async () => {
  mocks.serverZone = "America/Los_Angeles";
  await signIn();
  mocks.zone = "Europe/Paris";
  mocks.appState!("background");
  await settle();
  expect(puts()).toEqual([]);
  mocks.appState!("active");
  await settle();
  expect(puts()).toEqual([
    expect.objectContaining({ body: { timezone: "Europe/Paris" } }),
  ]);
});

it("stops sending a zone the server rejects", async () => {
  mocks.request.mockImplementation(async (options) =>
    options.method === "PUT"
      ? {
          ok: false,
          error: {
            kind: "http_error",
            status: 422,
            code: "VALIDATION_ERROR",
            message: "bad zone",
          },
        }
      : { ok: true, value: { profile: serverProfile("UTC") } },
  );
  await signIn();
  mocks.appState!("active");
  await settle();
  expect(puts()).toHaveLength(1);
});

it("retries an offline save when the app returns to the foreground", async () => {
  mocks.request.mockImplementation(async (options) =>
    options.method === "PUT"
      ? { ok: false, error: { kind: "network_error", cause: null } }
      : { ok: true, value: { profile: serverProfile("UTC") } },
  );
  await signIn();
  mocks.appState!("active");
  await settle();
  expect(puts()).toHaveLength(2);
});
