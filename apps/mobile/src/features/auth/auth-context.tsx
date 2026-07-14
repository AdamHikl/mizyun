import type { AuthSession } from "@mizyun/identity";
import {
  createContext,
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

interface AuthContextValue {
  session: AuthSession | null;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
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

  const value = useMemo(
    () => ({ session, signOut: () => authClient.signOut() }),
    [session],
  );

  if (!configuration.configured)
    return <AuthSetupScreen reason={configuration.reason} />;
  if (loading) return <LoadingScreen />;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function SessionGate({ children }: { children: ReactNode }) {
  const context = useContext(AuthContext);
  if (!context) return null;
  return context.session ? children : <AuthScreen />;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
