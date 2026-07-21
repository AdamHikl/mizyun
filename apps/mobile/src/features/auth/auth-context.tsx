import type { Profile } from "@mizyun/contracts";
import type { AuthSession, DeepLinkPayload } from "@mizyun/identity";
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

import { apiClient, apiConfiguration } from "@/composition/api-client";
import { authClient } from "@/composition/auth-client";
import { profileResponseSchema } from "@mizyun/contracts";
import { AuthScreen } from "./auth-screen";
import { AuthSetupScreen } from "./auth-setup-screen";
import { LoadingScreen } from "./loading-screen";
import { OnboardingScreen } from "@/features/onboarding/onboarding-screen";
import { ResetPasswordScreen } from "./reset-password-screen";
import { resolveSessionGateTarget } from "./session-gate-state";

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
  /**
   * Re-fetch the profile from the API. Called after the onboarding
   * flow completes so the SessionGate sees the freshly-set
   * displayName and stops routing to onboarding on subsequent
   * sign-ins.
   */
  refreshProfile(): Promise<void>;
  signOut(): Promise<void>;
  /**
   * Consume a deep-link payload delivered by the auth provider. Sets
   * the session (or the recovery state, depending on the payload kind)
   * and persists it for the next `getSession()` call. Used by the
   * top-level Linking listener in `_layout.tsx`.
   */
  consumeDeepLink(payload: DeepLinkPayload): Promise<AuthSession>;
  /**
   * Mark the recovery flow as complete. Called by the reset-password
   * screen after `updatePassword` succeeds so the SessionGate falls
   * back to rendering the regular children.
   */
  clearRecoveryState(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [recoveryState, setRecoveryState] = useState(false);
  const profileRequestVersion = useRef(0);
  const configuration = authClient.status();

  const fetchProfile = useCallback(async (): Promise<Profile | null> => {
    if (!apiConfiguration.configured) {
      return null;
    }
    const result = await apiClient.request<{ profile: Profile }>({
      method: "GET",
      path: "/v1/profile",
      schema: profileResponseSchema,
    });
    if (result.ok) {
      return result.value.profile;
    }
    // A failing profile load is treated as "no profile yet" so the
    // SessionGate routes to onboarding after loading. Submission then
    // surfaces the actionable API/network error without exposing protected
    // dashboard children against unresolved profile state.
    return null;
  }, []);

  const applySession = useCallback(
    (nextSession: AuthSession | null): void => {
      const requestVersion = ++profileRequestVersion.current;
      setSession(nextSession);
      setProfile(null);
      if (nextSession === null) {
        setProfileLoading(false);
        return;
      }

      setProfileLoading(true);
      void fetchProfile()
        .then((nextProfile) => {
          if (profileRequestVersion.current === requestVersion) {
            setProfile(nextProfile);
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
    authClient
      .getSession()
      .then((value) => {
        if (!active) return;
        applySession(value);
      })
      .finally(() => active && setLoading(false));
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
    const requestVersion = ++profileRequestVersion.current;
    setProfileLoading(true);
    const nextProfile = await fetchProfile();
    if (profileRequestVersion.current === requestVersion) {
      setProfile(nextProfile);
      setProfileLoading(false);
    }
  }, [fetchProfile]);

  const clearRecoveryState = useCallback(() => setRecoveryState(false), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      recoveryState,
      signOut: () => authClient.signOut(),
      consumeDeepLink,
      clearRecoveryState,
      refreshProfile,
    }),
    [
      session,
      profile,
      recoveryState,
      consumeDeepLink,
      clearRecoveryState,
      refreshProfile,
    ],
  );

  if (!configuration.configured)
    return <AuthSetupScreen reason={configuration.reason} />;
  if (loading || profileLoading) return <LoadingScreen />;
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
  switch (target) {
    case "recovery":
      return <ResetPasswordScreen />;
    case "auth":
      return <AuthScreen />;
    case "onboarding":
      return <OnboardingGate />;
    case "content":
      return <>{children}</>;
  }
}

/**
 * Wrapper for the onboarding screen. The SessionGate routes a
 * freshly-authenticated user with `displayName === null` here; once
 * the wizard completes, `refreshProfile()` flips the profile state
 * and the SessionGate falls back to rendering the regular children.
 */
function OnboardingGate() {
  const context = useContext(AuthContext);
  if (!context) return null;
  return <OnboardingScreen onComplete={() => void context.refreshProfile()} />;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
