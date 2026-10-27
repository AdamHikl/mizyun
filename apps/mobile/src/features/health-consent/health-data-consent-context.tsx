import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";

import { apiClient } from "@/composition/api-client";
import type {
  HealthDataConsentStatus,
  LoadedHealthDataConsent,
} from "./health-data-consent";
import { HealthDataConsentController } from "./health-data-consent-controller";

export interface HealthDataConsentContextValue {
  readonly status: HealthDataConsentStatus | "loading";
  readonly withdrawn: boolean;
  /** Resolves to an error message, or null when saved. */
  grant(): Promise<string | null>;
  withdraw(): Promise<string | null>;
  /** Asks again after "unavailable". */
  retry(): void;
}

const HealthDataConsentContext =
  createContext<HealthDataConsentContextValue | null>(null);

/** Always-granted value for the Dev preview session, which has no server. */
const PREVIEW_VALUE: HealthDataConsentContextValue = {
  status: "granted",
  withdrawn: false,
  grant: async () => null,
  withdraw: async () => "The preview has no account to change.",
  retry: () => undefined,
};

/**
 * Holds the signed-in user's health-data consent for the session gate and
 * Settings, and asks the server again whenever the app returns to the
 * foreground so a withdrawal on another device closes this one too.
 */
export function HealthDataConsentProvider({
  userId,
  preview,
  children,
}: {
  readonly userId: string;
  readonly preview: boolean;
  readonly children: ReactNode;
}) {
  const [state, setState] = useState<{
    readonly userId: string;
    readonly consent: LoadedHealthDataConsent | null;
  } | null>(null);
  const controller = useMemo(
    () =>
      new HealthDataConsentController({
        userId,
        client: apiClient,
        store: SecureStore,
        onChange: (consent) => setState({ userId, consent }),
      }),
    [userId],
  );

  useEffect(() => {
    if (preview) return;
    void controller.start();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void controller.refresh();
    });
    return () => {
      controller.dispose();
      subscription.remove();
    };
  }, [controller, preview]);

  const value = useMemo<HealthDataConsentContextValue>(() => {
    if (preview) return PREVIEW_VALUE;
    const consent = state?.userId === userId ? state.consent : null;
    return {
      status: consent?.status ?? "loading",
      withdrawn: consent?.withdrawn ?? false,
      grant: () => controller.save(true),
      withdraw: () => controller.save(false),
      retry: () => void controller.start(),
    };
  }, [controller, preview, state, userId]);

  return (
    <HealthDataConsentContext.Provider value={value}>
      {children}
    </HealthDataConsentContext.Provider>
  );
}

export function useHealthDataConsent(): HealthDataConsentContextValue | null {
  return useContext(HealthDataConsentContext);
}
