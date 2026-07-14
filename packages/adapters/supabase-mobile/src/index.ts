import "react-native-url-polyfill/auto";

import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";
import {
  createClient,
  processLock,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";

import type { UserId } from "@mizyun/core";
import {
  IdentityError,
  type AuthClient,
  type AuthConfigurationStatus,
  type AuthSession,
  type AuthStateListener,
  type PasswordCredentials,
  type SignUpResult,
} from "@mizyun/identity";

import { ChunkedStorage, type StringStorage } from "./chunked-storage.js";

const secureStorePrimitive: StringStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

const memoryStorage = (): StringStorage => {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
};

const webStorage = (): StringStorage => {
  const storage = globalThis.localStorage;
  if (!storage) return memoryStorage();
  return {
    getItem: async (key) => storage.getItem(key),
    setItem: async (key, value) => storage.setItem(key, value),
    removeItem: async (key) => storage.removeItem(key),
  };
};

const toAuthSession = (session: Session | null): AuthSession | null => {
  if (!session) return null;
  const email = session.user.email;
  return {
    user: {
      id: session.user.id as UserId,
      ...(email ? { email } : {}),
    },
    accessToken: session.access_token,
    ...(session.expires_at
      ? { expiresAt: new Date(session.expires_at * 1000) }
      : {}),
  };
};

const asIdentityError = (error: unknown): IdentityError => {
  const message =
    error instanceof Error ? error.message : "Authentication failed.";
  return new IdentityError("AUTH_PROVIDER_ERROR", message, error);
};

export interface SupabaseMobileConfiguration {
  readonly url: string;
  readonly publishableKey: string;
}

export class SupabaseMobileAuthClient implements AuthClient {
  readonly #disposers: Array<() => void> = [];

  constructor(private readonly client: SupabaseClient) {
    if (Platform.OS !== "web") {
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") this.client.auth.startAutoRefresh();
        else this.client.auth.stopAutoRefresh();
      });
      this.#disposers.push(() => subscription.remove());
    }
  }

  status(): AuthConfigurationStatus {
    return { configured: true, provider: "supabase" };
  }

  async getSession(): Promise<AuthSession | null> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw asIdentityError(error);
    return toAuthSession(data.session);
  }

  async signInWithPassword(
    credentials: PasswordCredentials,
  ): Promise<AuthSession> {
    const { data, error } =
      await this.client.auth.signInWithPassword(credentials);
    if (error) throw asIdentityError(error);
    const session = toAuthSession(data.session);
    if (!session)
      throw new IdentityError(
        "AUTH_SESSION_MISSING",
        "Sign-in returned no session.",
      );
    return session;
  }

  async signUpWithPassword(
    credentials: PasswordCredentials,
  ): Promise<SignUpResult> {
    const { data, error } = await this.client.auth.signUp(credentials);
    if (error) throw asIdentityError(error);
    const session = toAuthSession(data.session);
    return { session, emailConfirmationRequired: session === null };
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw asIdentityError(error);
  }

  subscribe(listener: AuthStateListener): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      listener(toAuthSession(session));
    });
    return () => data.subscription.unsubscribe();
  }

  dispose(): void {
    this.#disposers.splice(0).forEach((dispose) => dispose());
    this.client.auth.stopAutoRefresh();
  }
}

export const createSupabaseMobileAuthClient = (
  configuration: SupabaseMobileConfiguration,
): AuthClient => {
  const storage =
    Platform.OS === "web"
      ? webStorage()
      : new ChunkedStorage(secureStorePrimitive);
  const client = createClient(configuration.url, configuration.publishableKey, {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      lock: processLock,
    },
  });

  return new SupabaseMobileAuthClient(client);
};
