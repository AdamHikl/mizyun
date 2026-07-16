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

import { authClient } from "@/composition/auth-client";
import { AuthScreen } from "./auth-screen";
import { AuthSetupScreen } from "./auth-setup-screen";
import { LoadingScreen } from "./loading-screen";
import { ResetPasswordScreen } from "./reset-password-screen";

interface AuthContextValue {
  session: AuthSession | null;
  /**
   * True after a `kind: "recovery"` deep link has been consumed and
   * `updatePassword` has not yet succeeded. Cleared by the reset-password
   * screen after the user submits a new password.
   */
  recoveryState: boolean;
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
  const [loading, setLoading] = useState(true);
  const [recoveryState, setRecoveryState] = useState(false);
  const configuration = authClient.status();

  useEffect(() => {
    if (!configuration.configured) {
      setLoading(false);
      return;
    }
    let active = true;
    authClient
      .getSession()
      .then((value) => active && setSession(value))
      .finally(() => active && setLoading(false));
    const unsubscribe = authClient.subscribe(
      (value) => active && setSession(value),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [configuration.configured]);

  const consumeDeepLink = useCallback(
    async (payload: DeepLinkPayload): Promise<AuthSession> => {
      const next = await authClient.consumeDeepLink(payload);
      setSession(next);
      if (payload.kind === "recovery") setRecoveryState(true);
      return next;
    },
    [],
  );

  const clearRecoveryState = useCallback(() => setRecoveryState(false), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      recoveryState,
      signOut: () => authClient.signOut(),
      consumeDeepLink,
      clearRecoveryState,
    }),
    [session, recoveryState, consumeDeepLink, clearRecoveryState],
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
  if (context.session) return children;
  return <AuthScreen />;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
