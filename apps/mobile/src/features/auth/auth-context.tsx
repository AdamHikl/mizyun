import type { Profile } from "@mizyun/contracts";
import type { AuthSession, DeepLinkPayload } from "@mizyun/identity";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

interface AuthContextValue {
  session: AuthSession | null;
  /**
   * True after a `kind: "recovery"` deep link has been consumed and
   * `updatePassword` has not yet succeeded. Cleared by the reset-password
   * screen after the user submits a new password.
   */
  recoveryState: boolean;
  /**
   * The verified user's profile, fetched once when the session is
   * established. `null` while the profile is loading, after sign-out,
   * or when the API is not configured. The SessionGate uses
   * `profile.displayName === null` to detect a fresh user and route
   * them into the onboarding flow.
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
  const [recoveryState, setRecoveryState] = useState(false);
  const configuration = authClient.status();

  const loadProfile = useCallback(async (): Promise<void> => {
    if (!apiConfiguration.configured) {
      setProfile(null);
      return;
    }
    const result = await apiClient.request<{ profile: Profile }>({
      method: "GET",
      path: "/v1/profile",
      schema: profileResponseSchema,
    });
    if (result.ok) {
      setProfile(result.value.profile);
    } else {
      // A failing profile load is treated as "no profile yet" so the
      // SessionGate can route the user into the onboarding flow. The
      // network error surfaces on the screen itself.
      setProfile(null);
    }
  }, []);

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
        setSession(value);
        return loadProfile();
      })
      .finally(() => active && setLoading(false));
    const unsubscribe = authClient.subscribe(
      (value) => active && setSession(value),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [configuration.configured, loadProfile]);

  const consumeDeepLink = useCallback(
    async (payload: DeepLinkPayload): Promise<AuthSession> => {
      const next = await authClient.consumeDeepLink(payload);
      setSession(next);
      if (payload.kind === "recovery") setRecoveryState(true);
      await loadProfile();
      return next;
    },
    [loadProfile],
  );

  const refreshProfile = useCallback(async () => {
    await loadProfile();
  }, [loadProfile]);

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
  if (loading) return <LoadingScreen />;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function SessionGate({ children }: { children: ReactNode }) {
  const context = useContext(AuthContext);
  if (!context) return null;
  // Recovery takes precedence: the user is signed in (the deep link
  // set the session), but the AuthScreen is not appropriate — we want
  // the reset-password screen instead.
  if (context.session && context.recoveryState) return <ResetPasswordScreen />;
  if (!context.session) return <AuthScreen />;
  // Onboarding: a fresh user has a profile row whose `displayName`
  // is null (the auto-create path inserts the defaults). The SessionGate
  // routes them through the wizard until `refreshProfile()` flips
  // `profile.displayName` to a non-null value.
  if (context.profile !== null && context.profile.displayName === null) {
    return <OnboardingGate />;
  }
  return <>{children}</>;
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
