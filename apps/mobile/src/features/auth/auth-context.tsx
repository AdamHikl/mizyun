import { retireIngredientReviews } from "@/features/meal-recipes/public-data";
import { setRecurringSuggestionOwner } from "@/features/recurring-meals/public-data";
import { deregisterCommunityPush } from "@/features/community/push";
import type { Profile } from "@mizyun/contracts";
import type { UserId } from "@mizyun/core";
import {
  isSameAuthSession,
  type AuthSession,
  type DeepLinkPayload,
} from "@mizyun/identity";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";

import { apiClient, apiConfiguration } from "@/composition/api-client";
import {
  invalidateCommunityReads,
  setCommunityReadPrincipal,
} from "@/features/community/state/read-cache";
import { getAppVariant } from "@/composition/app-variant";
import { authClient } from "@/composition/auth-client";
import { analyticsClient } from "@/composition/analytics-client";
import { firstMealReminderLifecycle } from "@/composition/first-meal-reminder-runtime";
import { profileResponseSchema } from "@mizyun/contracts";
import { AuthScreen } from "./auth-screen";
import { AuthSetupScreen } from "./auth-setup-screen";
import { LoadingScreen } from "./loading-screen";
import { OnboardingScreen } from "@/features/onboarding/onboarding-screen";
import { ResetPasswordScreen } from "./reset-password-screen";
import { resolveSessionGateTarget } from "./session-gate-state";
import { signOutCapturedSession } from "./session-bound-sign-out";
import {
  forgetMealVisualMemory,
  setMealPhotoPrincipal,
} from "@/features/log-meal/public-data";
import { hydrateAuthBootstrap } from "./auth-bootstrap";
import {
  createProfileTimeZoneSync,
  readDeviceTimeZone,
  type TimeZoneSyncTrigger,
} from "./profile-time-zone-sync";
import {
  loadCachedProfile,
  purgeOfflineCache,
  saveCachedProfile,
} from "@/features/offline-cache/offline-cache-storage";

interface AuthContextValue {
  session: AuthSession | null;
  /**
   * True after a `kind: "recovery"` deep link has been consumed and
   * `updatePassword` has not yet succeeded. Cleared by the reset-password
   * screen after the user submits a new password.
   */
  recoveryState: boolean;
  /**
   * The verified user's profile, fetched whenever the session changes.
   * `null` after sign-out, when the API is not configured, or when the
   * profile request fails. The provider keeps the loading state outside
   * the context so protected children never render against a session whose
   * profile has not been resolved yet.
   */
  profile: Profile | null;
  isOnboardingActive: boolean;
  openOnboarding(): void;
  closeOnboarding(): void;
  refreshProfile(): Promise<void>;
  signOut(): Promise<void>;
  /**
   * Consumes a recovery or magic-link callback URL delivered by a deep
   * link. Sets the session, clears any stale recovery flag, and enters
   * recovery mode if the deep link was a password recovery callback.
   */
  consumeDeepLink(payload: DeepLinkPayload): Promise<AuthSession>;
  /**
   * Clears the `recoveryState` flag once the user has finished updating
   * their password. Transitions the session gate from the reset-password
   * back to rendering the regular children.
   */
  clearRecoveryState(): void;
  explorePreview(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const PREVIEW_USER_ID = "00000000-0000-0000-0000-000000000001" as UserId;

const PREVIEW_SESSION: AuthSession = {
  user: { id: PREVIEW_USER_ID, email: "founder@mizyun.app" },
  accessToken: "preview-token",
};

const PREVIEW_PROFILE: Profile = {
  userId: PREVIEW_USER_ID,
  displayName: "Adam",
  unitSystem: "metric",
  timezone: "UTC",
  heightCm: 180,
  birthYear: 1995,
  sexAtBirth: "male",
  activityLevel: "moderately_active",
  planTier: "paid",
  aiProvider: "gemini",
  coachingPreferences: {
    experienceLevel: "intermediate",
    trainingDaysPerWeek: 4,
    sessionDurationMinutes: 60,
    trainingFocus: "hypertrophy",
    availableEquipment: ["full_gym"],
    dietaryPreferences: ["omnivore"],
    trainingLimitations: [],
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [recoveryState, setRecoveryState] = useState(false);
  const [isOnboardingActive, setIsOnboardingActive] = useState(false);
  const profileRequestVersion = useRef(0);
  const pushSession = useRef<AuthSession | null>(null);

  const openOnboarding = useCallback(() => setIsOnboardingActive(true), []);
  const closeOnboarding = useCallback(() => setIsOnboardingActive(false), []);
  const configuration = authClient.status();

  const fetchProfile = useCallback(async (): Promise<Profile | null> => {
    if (!apiConfiguration.configured) {
      return null;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const result = await apiClient.request<{ profile: Profile }>({
        method: "GET",
        path: "/v1/profile",
        schema: profileResponseSchema,
        signal: controller.signal,
      });
      if (result.ok) {
        return result.value.profile;
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  const applySession = useCallback(
    (nextSession: AuthSession | null): void => {
      setCommunityReadPrincipal(
        nextSession?.user.id ?? null,
        nextSession?.accessToken ?? null,
      );
      const previousPushSession = pushSession.current;
      setRecurringSuggestionOwner(
        nextSession && nextSession.accessToken !== "preview-token"
          ? nextSession.user.id
          : null,
      );
      pushSession.current = nextSession;
      if (
        previousPushSession?.user.id !== nextSession?.user.id ||
        nextSession?.accessToken === "preview-token"
      ) {
        void firstMealReminderLifecycle
          .setOwner(
            nextSession && nextSession.accessToken !== "preview-token"
              ? nextSession.user.id
              : null,
          )
          .catch(() => {});
      }
      if (
        previousPushSession &&
        previousPushSession.user.id !== nextSession?.user.id
      ) {
        setProfile(null);
        setIsOnboardingActive(false);
        setRecoveryState(false);
      }
      if (
        previousPushSession &&
        previousPushSession.user.id !== nextSession?.user.id
      )
        void deregisterCommunityPush(previousPushSession);
      if (
        previousPushSession &&
        previousPushSession.user.id !== nextSession?.user.id
      )
        void retireIngredientReviews(previousPushSession.user.id, "account");
      const requestVersion = ++profileRequestVersion.current;
      // Queue the identity boundary before any new consent sync or UI capture.
      // Analytics serializes these operations; authentication never waits on it.
      if (
        nextSession === null ||
        nextSession.accessToken === "preview-token" ||
        (previousPushSession !== null &&
          previousPushSession.user.id !== nextSession.user.id)
      ) {
        void analyticsClient.resetLocalSession().catch(() => {});
      }
      if (
        previousPushSession &&
        previousPushSession.user.id !== nextSession?.user.id
      )
        forgetMealVisualMemory();
      setMealPhotoPrincipal(
        nextSession?.user.id ?? null,
        nextSession?.accessToken ?? null,
      );
      setSession(nextSession);
      if (nextSession === null) {
        setProfile(null);
        setIsOnboardingActive(false);
        setProfileLoading(false);
        return;
      }
      if (nextSession.accessToken === "preview-token") {
        setProfile(PREVIEW_PROFILE);
        setIsOnboardingActive(false);
        setProfileLoading(false);
        return;
      }

      const userId = nextSession.user.id;
      void analyticsClient.syncConsent().catch(() => {});
      setProfileLoading(true);

      // Pre-populate with cached profile immediately to avoid layout flash / false onboarding redirect
      void loadCachedProfile(userId).then((cached) => {
        if (
          profileRequestVersion.current === requestVersion &&
          cached !== null
        ) {
          setProfile((current) => current ?? cached.profile);
        }
      });

      void fetchProfile()
        .then((nextProfile) => {
          if (profileRequestVersion.current === requestVersion) {
            if (nextProfile !== null) {
              setProfile(nextProfile);
              void saveCachedProfile(userId, nextProfile);
            } else {
              // Server fetch failed (e.g. offline) -> fallback to cached profile
              void loadCachedProfile(userId).then((cached) => {
                if (
                  profileRequestVersion.current === requestVersion &&
                  cached !== null
                ) {
                  setProfile(cached.profile);
                }
              });
            }
          }
        })
        .finally(() => {
          if (profileRequestVersion.current === requestVersion) {
            setProfileLoading(false);
          }
        });
    },
    [fetchProfile],
  );

  useEffect(() => {
    if (!configuration.configured) {
      setLoading(false);
      return;
    }
    let active = true;
    const startupRevision = profileRequestVersion.current;
    void hydrateAuthBootstrap({
      isCurrent: () =>
        active && profileRequestVersion.current === startupRevision,
      getSession: () => authClient.getSession(),
      cachedProfile: async (userId) =>
        (await loadCachedProfile(userId))?.profile ?? null,
      applyProfile: setProfile,
      applySession,
    }).finally(() => active && setLoading(false));
    const unsubscribe = authClient.subscribe(
      (value) => active && applySession(value),
    );
    return () => {
      active = false;
      profileRequestVersion.current += 1;
      unsubscribe();
    };
  }, [applySession, configuration.configured]);

  const consumeDeepLink = useCallback(
    async (payload: DeepLinkPayload): Promise<AuthSession> => {
      const next = await authClient.consumeDeepLink(payload);
      applySession(next);
      if (payload.kind === "recovery") setRecoveryState(true);
      return next;
    },
    [applySession],
  );

  const refreshProfile = useCallback(async () => {
    if (!session || !isSameAuthSession(session, pushSession.current)) return;
    const requestVersion = ++profileRequestVersion.current;
    setProfileLoading(true);
    const currentUserId = session?.user.id;
    try {
      const nextProfile = await fetchProfile();
      if (profileRequestVersion.current === requestVersion) {
        if (nextProfile !== null) {
          setProfile(nextProfile);
          if (currentUserId) {
            void saveCachedProfile(currentUserId, nextProfile);
          }
        } else if (currentUserId) {
          const cached = await loadCachedProfile(currentUserId);
          if (
            profileRequestVersion.current === requestVersion &&
            cached !== null
          ) {
            setProfile(cached.profile);
          }
        }
      }
    } finally {
      if (profileRequestVersion.current === requestVersion) {
        setProfileLoading(false);
      }
    }
  }, [fetchProfile, session]);

  // REL-01: store the phone's zone so Coach's "today" matches Home's.
  const timeZoneSync = useRef(
    createProfileTimeZoneSync({
      deviceTimeZone: readDeviceTimeZone,
      save: async (timezone) => {
        const result = await apiClient.request<{ profile: Profile }>({
          method: "PUT",
          path: "/v1/profile",
          body: { timezone },
          schema: profileResponseSchema,
        });
        if (result.ok) return result.value.profile;
        const { error } = result;
        return error.kind === "http_error" &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 401 &&
          error.status !== 408 &&
          error.status !== 429
          ? "rejected"
          : null;
      },
    }),
  ).current;
  const syncTimeZone = useCallback(
    (current: Profile | null, trigger: TimeZoneSyncTrigger) => {
      const owner = pushSession.current;
      if (
        !apiConfiguration.configured ||
        owner === null ||
        owner.accessToken === "preview-token" ||
        current?.userId !== owner.user.id
      )
        return;
      void timeZoneSync.sync(current, trigger).then((saved) => {
        if (saved === null || pushSession.current?.user.id !== saved.userId)
          return;
        setProfile(saved);
        void saveCachedProfile(saved.userId, saved);
      });
    },
    [timeZoneSync],
  );
  const latestProfile = useRef<Profile | null>(null);
  useEffect(() => {
    latestProfile.current = profile;
    // Wait for the server read so a cached profile does not trigger a save.
    if (!profileLoading) syncTimeZone(profile, "profile");
  }, [profile, profileLoading, syncTimeZone]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") syncTimeZone(latestProfile.current, "foreground");
    });
    return () => subscription.remove();
  }, [syncTimeZone]);

  const clearRecoveryState = useCallback(() => setRecoveryState(false), []);

  const explorePreview = useCallback(() => {
    if (getAppVariant() !== "dev") return;
    applySession(PREVIEW_SESSION);
  }, [applySession]);

  const signOut = useCallback(async () => {
    const captured = session;
    if (
      captured &&
      pushSession.current?.user.id === captured.user.id &&
      pushSession.current.accessToken === captured.accessToken
    ) {
      // Retire authority before asynchronous logout cleanup. A rerender must
      // not activate another controller for the departing session.
      setRecurringSuggestionOwner(null);
      void retireIngredientReviews(captured.user.id, "account");
    }
    invalidateCommunityReads();
    await signOutCapturedSession(session, {
      current: () => pushSession.current,
      purge: purgeOfflineCache,
      deregister: deregisterCommunityPush,
      signOut: (captured) => authClient.signOut(captured),
      clear: () => applySession(null),
    });
  }, [applySession, session?.accessToken, session?.user.id]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      recoveryState,
      isOnboardingActive,
      openOnboarding,
      closeOnboarding,
      signOut,
      consumeDeepLink,
      clearRecoveryState,
      refreshProfile,
      explorePreview,
    }),
    [
      session,
      profile,
      recoveryState,
      isOnboardingActive,
      openOnboarding,
      closeOnboarding,
      signOut,
      consumeDeepLink,
      clearRecoveryState,
      refreshProfile,
      explorePreview,
    ],
  );

  if (!configuration.configured)
    return <AuthSetupScreen reason={configuration.reason} />;
  if (loading) return <LoadingScreen />;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function SessionGate({ children }: { children: ReactNode }) {
  const context = useContext(AuthContext);
  if (!context) return null;
  const target = resolveSessionGateTarget({
    hasSession: context.session !== null,
    recoveryState: context.recoveryState,
    profile: context.profile,
  });
  if (target === "content" && context.isOnboardingActive) {
    return (
      <OnboardingScreen
        onComplete={async () => {
          await context.refreshProfile();
          context.closeOnboarding();
        }}
        onExit={() => context.closeOnboarding()}
      />
    );
  }
  switch (target) {
    case "recovery":
      return <ResetPasswordScreen />;
    case "auth":
      return <AuthScreen />;
    case "content":
      return <>{children}</>;
  }
}

export function useOptionalAuth() {
  return useContext(AuthContext);
}

export function useAuth() {
  const context = useOptionalAuth();
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
