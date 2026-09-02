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
  type DeepLinkPayload,
  type OAuthSignInOptions,
  type OAuthSignInResult,
  type PasswordCredentials,
  type SignUpResult,
} from "@mizyun/identity";

import { ChunkedStorage, type StringStorage } from "./chunked-storage";
import { createWebStorage } from "./web-storage";

const secureStorePrimitive: StringStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

const toAuthSession = (session: Session | null): AuthSession | null => {
  if (!session) return null;
  const email = session.user.email;
  const provider =
    (session.user.app_metadata?.provider as string | undefined) ??
    (session.user.identities?.[0]?.provider as string | undefined) ??
    "email";
  return {
    user: {
      id: session.user.id as UserId,
      ...(email ? { email } : {}),
      provider,
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
  /** Deep-link URI generated from the current app variant's scheme. */
  readonly redirectUri?: string;
}

export class SupabaseMobileAuthClient implements AuthClient {
  readonly #disposers: Array<() => void> = [];
  // Set to true when the last deep link delivered was a `kind:
  // "recovery"` payload, and cleared after `updatePassword` succeeds.
  // The AuthContext reads this to decide whether to show the
  // reset-password screen in place of the AuthScreen.
  #inRecovery = false;

  constructor(
    private readonly client: SupabaseClient,
    private readonly redirectUri = "mizyun://auth/callback",
  ) {
    if (Platform.OS !== "web") {
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") this.client.auth.startAutoRefresh();
        else this.client.auth.stopAutoRefresh();
      });
      this.#disposers.push(() => subscription.remove());
    }
    // The Supabase SDK fires PASSWORD_RECOVERY as soon as the implicit
    // flow lands and `setSession` consumes the tokens. We listen once
    // here so the recovery flag is set even when the deep link is
    // delivered before the AuthContext has subscribed (cold-start).
    this.#disposers.push(
      this.client.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY") this.#inRecovery = true;
      }).data.subscription.unsubscribe,
    );
  }

  status(): AuthConfigurationStatus {
    return { configured: true, provider: "supabase" };
  }

  /**
   * Whether the client is currently in the recovery state (a `kind:
   * "recovery"` deep link has been consumed and `updatePassword` has
   * not yet succeeded). Surfaced via the AuthContext so the router can
   * swap the AuthScreen for the reset-password screen.
   */
  isInRecoveryState(): boolean {
    return this.#inRecovery;
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

  async signInWithOAuth(
    options: OAuthSignInOptions,
  ): Promise<OAuthSignInResult> {
    const { data, error } = await this.client.auth.signInWithOAuth({
      provider: options.provider,
      options: {
        redirectTo: options.redirectTo ?? this.redirectUri,
        skipBrowserRedirect: true,
      },
    });
    if (error) throw asIdentityError(error);
    if (!data.url) {
      throw new IdentityError(
        "AUTH_PROVIDER_ERROR",
        "OAuth sign-in returned no authorization URL.",
      );
    }
    return { url: data.url };
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw asIdentityError(error);
    this.#inRecovery = false;
  }

  async consumeDeepLink(payload: DeepLinkPayload): Promise<AuthSession> {
    if (payload.kind === "recovery") this.#inRecovery = true;
    const { data, error } = await this.client.auth.setSession({
      access_token: payload.accessToken,
      refresh_token: payload.refreshToken,
    });
    if (error) throw asIdentityError(error);
    const session = toAuthSession(data.session);
    if (!session) {
      throw new IdentityError(
        "AUTH_SESSION_MISSING",
        "Deep-link payload did not produce a session.",
      );
    }
    return session;
  }

  async updatePassword(newPassword: { password: string }): Promise<void> {
    const currentSession = await this.client.auth.getSession();
    if (!this.#inRecovery && !currentSession.data.session) {
      throw new IdentityError(
        "AUTH_NOT_IN_RECOVERY",
        "updatePassword is only valid after a recovery deep link is consumed or with an active session.",
      );
    }
    const { error } = await this.client.auth.updateUser({
      password: newPassword.password,
    });
    if (error) throw asIdentityError(error);
    this.#inRecovery = false;
  }

  async requestPasswordRecovery(email: { email: string }): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(
      email.email,
      {
        redirectTo: this.redirectUri,
      },
    );
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
      ? createWebStorage()
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
