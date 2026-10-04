import { beforeEach, expect, it, vi } from "vitest";
import type { AuthSession } from "@mizyun/identity";
import type { UserId } from "@mizyun/core";
import type { AnalyticsConsentResponse } from "@mizyun/contracts";
import { CURRENT_ANALYTICS_CONSENT_VERSION } from "@mizyun/contracts";
import {
  NetworkAnalyticsClient,
  type AnalyticsStorageFile,
  type NetworkAnalyticsApiTransport,
} from "../analytics/network-analytics-client";
const mocks = vi.hoisted(() => ({
  subscribe: null as ((value: AuthSession | null) => void) | null,
  analytics: null as NetworkAnalyticsClient | null,
  slots: [] as any[],
  index: 0,
  effects: [] as (() => void)[],
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
        mocks.slots[index] = next;
      },
    ];
  },
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void) => {
    mocks.effects.push(fn);
  },
}));
vi.mock("@/composition/analytics-client", () => ({
  analyticsClient: {
    resetLocalSession: () => mocks.analytics!.resetLocalSession(),
    syncConsent: () => mocks.analytics!.syncConsent(),
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
  },
}));
vi.mock("@/composition/api-client", () => ({
  apiConfiguration: { configured: false },
  apiClient: {},
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
  saveCachedProfile: vi.fn(),
  purgeOfflineCache: vi.fn(),
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
import { AuthProvider } from "./auth-context";

function file(): AnalyticsStorageFile {
  let value: string | null = null;
  return {
    get exists() {
      return value !== null;
    },
    text: async () => value ?? "",
    write: (next) => {
      value = next;
    },
    delete: () => {
      value = null;
    },
  };
}
const session = (id: string): AuthSession => ({
  user: { id: id as UserId },
  accessToken: `${id}-token`,
});
const consent = (owner: string): AnalyticsConsentResponse => ({
  version: CURRENT_ANALYTICS_CONSENT_VERSION,
  granted: true,
  revision: 1,
  epoch:
    owner === "a"
      ? "00000000-0000-4000-8000-000000000001"
      : "00000000-0000-4000-8000-000000000002",
  consentedAt: new Date().toISOString(),
  revokedAt: null,
  updatedAt: new Date().toISOString(),
});
beforeEach(() => {
  mocks.slots = [];
  mocks.index = 0;
  mocks.effects = [];
  mocks.subscribe = null;
});

it("resets an offline A queue before synchronizing a directly replacing B account", async () => {
  let owner = "a";
  let online = false;
  const uploaded: any[] = [];
  const transport: NetworkAnalyticsApiTransport = {
    getConsent: async () => ({ ok: true, data: consent(owner) }),
    updateConsent: async () => ({ ok: false }),
    clearEvents: async () => ({ ok: false }),
    listEvents: async () => ({ ok: false }),
    ingestBatch: async (batch) => {
      if (!online) return { ok: false };
      uploaded.push({ owner, batch });
      return {
        ok: true,
        data: {
          acceptedIds: batch.events.map((event) => event.id),
          rejectedCount: 0,
        },
      };
    },
  };
  const analytics = new NetworkAnalyticsClient(transport, file(), file());
  mocks.analytics = analytics;
  AuthProvider({ children: null });
  mocks.effects.splice(0).forEach((effect) => effect());
  mocks.subscribe!(session("a"));
  await analytics.syncConsent();
  await analytics.track({
    name: "dashboard_control_clicked",
    properties: { control: "nutrition_card" },
  });
  await analytics.flush();
  expect(await analytics.list()).toHaveLength(1);
  owner = "b";
  mocks.subscribe!(session("b"));
  await analytics.syncConsent();
  expect(await analytics.list()).toEqual([]);
  online = true;
  await analytics.track({
    name: "settings_search_selected",
    properties: { destination: "appearance" },
  });
  await analytics.flush();
  expect(uploaded).toHaveLength(1);
  expect(uploaded[0]).toMatchObject({
    owner: "b",
    batch: {
      epoch: consent("b").epoch,
      events: [
        {
          name: "settings_search_selected",
          properties: { destination: "appearance" },
        },
      ],
    },
  });
});
