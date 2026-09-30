import type { UserId } from "@mizyun/core";

export interface AuthUser {
  readonly id: UserId;
  readonly email?: string;
  readonly provider?: string;
}

export interface AuthSession {
  readonly user: AuthUser;
  readonly accessToken: string;
  readonly expiresAt?: Date;
  /** Provider session identity, stable across access-token refreshes. */
  readonly sessionId?: string;
}

/** Compare auth lifecycle authority, never use this as token verification. */
export function isSameAuthSession(
  left: {
    readonly user: { readonly id: string };
    readonly accessToken: string;
    readonly sessionId?: string;
  } | null,
  right: {
    readonly user: { readonly id: string };
    readonly accessToken: string;
    readonly sessionId?: string;
  } | null,
): boolean {
  if (!left || !right || left.user.id !== right.user.id) return false;
  return left.sessionId && right.sessionId
    ? left.sessionId === right.sessionId
    : left.accessToken === right.accessToken;
}

export interface AuthPrincipal {
  readonly userId: UserId;
  readonly email?: string;
  readonly role?: string;
  /**
   * The verified bearer token. Surfaced so downstream
   * repositories (e.g. PERSIST-001 Supabase adapters) can
   * construct a per-request client bound to the user's RLS
   * session. The auth plugin verifies the token once; the
   * adapter reuses it for PostgREST queries.
   */
  readonly accessToken: string;
}

export type AuthConfigurationStatus =
  | { readonly configured: true; readonly provider: string }
  | {
      readonly configured: false;
      readonly provider: string;
      readonly reason: string;
    };

export interface PasswordCredentials {
  readonly email: string;
  readonly password: string;
}

export interface SignUpResult {
  readonly session: AuthSession | null;
  readonly emailConfirmationRequired: boolean;
}

export type OAuthProvider = "google" | "apple";

export interface OAuthSignInOptions {
  readonly provider: OAuthProvider;
  readonly redirectTo?: string;
}

export interface OAuthSignInResult {
  readonly url: string;
}

export type IdTokenProvider = "apple" | "google";

export interface IdTokenCredentials {
  readonly provider: IdTokenProvider;
  readonly token: string;
  readonly nonce?: string;
  readonly accessToken?: string;
}

export type AuthStateListener = (session: AuthSession | null) => void;

/**
 * Discriminated union for the parsed deep-link payload delivered by
 * the auth provider. The recovery case signals that the caller should
 * drive `updatePassword({ password })` next; the signup, magiclink, and
 * oauth cases carry the verified session; the email_change case is
 * exposed for completeness; unknown covers any other `type` value
 * delivered by the provider.
 */
export type DeepLinkPayload =
  | {
      readonly kind: "recovery";
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly expiresAt?: Date;
    }
  | {
      readonly kind: "signup";
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly expiresAt?: Date;
    }
  | {
      readonly kind: "magiclink";
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly expiresAt?: Date;
    }
  | {
      readonly kind: "oauth";
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly expiresAt?: Date;
    }
  | {
      readonly kind: "email_change";
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly expiresAt?: Date;
    }
  | {
      readonly kind: "unknown";
      readonly type: string;
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly expiresAt?: Date;
    };

export interface AuthClient {
  status(): AuthConfigurationStatus;
  getSession(): Promise<AuthSession | null>;
  signInWithPassword(credentials: PasswordCredentials): Promise<AuthSession>;
  signUpWithPassword(credentials: PasswordCredentials): Promise<SignUpResult>;
  signInWithOAuth(options: OAuthSignInOptions): Promise<OAuthSignInResult>;
  signInWithIdToken(credentials: IdTokenCredentials): Promise<AuthSession>;
  signOut(capturedSession?: AuthSession): Promise<void>;
  /**
   * Consume a deep-link payload delivered by the auth provider (e.g.
   * `mizyun://auth/callback#access_token=...&refresh_token=...&type=recovery`).
   * Implementations persist the session so subsequent `getSession()`
   * returns it and the `onAuthStateChange` subscription fires. For
   * `kind: "recovery"` the client enters a special state that allows
   * the caller to drive `updatePassword` without re-authentication.
   */
  consumeDeepLink(payload: DeepLinkPayload): Promise<AuthSession>;
  /**
   * Update the current user's password. Only valid in the recovery
   * state set by `consumeDeepLink({ kind: "recovery" })`. Throws
   * `IdentityError` with code `AUTH_NOT_IN_RECOVERY` if the client is
   * not in that state, and `AUTH_NOT_CONFIGURED` if disabled.
   */
  updatePassword(newPassword: { password: string }): Promise<void>;
  /**
   * Begin the password recovery flow. Provider-specific implementation
   * sends the recovery email and returns once the provider accepted the
   * request. The actual password reset happens in two phases: the user
   * clicks the email link (which delivers a `kind: "recovery"` deep
   * link), then the app calls `updatePassword`.
   */
  requestPasswordRecovery(email: { email: string }): Promise<void>;
  subscribe(listener: AuthStateListener): () => void;
  dispose(): void;
}

export interface AccessTokenVerifier {
  verify(accessToken: string): Promise<AuthPrincipal | null>;
}

export class IdentityError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "IdentityError";
  }
}

/**
 * Parse the fragment (or query parameters) of a `mizyun://auth/callback#...`
 * deep link into a typed `DeepLinkPayload`. The GoTrue flow delivers the
 * access/refresh tokens in the URL fragment (or query); the access token
 * alone is not enough to establish a session, so both are required. An empty
 * fragment/query returns `null` — the URL was not a valid callback.
 *
 * Provider-agnostic: accepts the raw URL the platform's `Linking`
 * surfaces (which preserves the fragment) and returns the typed
 * payload the auth client needs to consume the session.
 */
export const parseDeepLinkFragment = (
  rawUrl: string,
): DeepLinkPayload | null => {
  let paramString = "";
  const hashIndex = rawUrl.indexOf("#");
  if (hashIndex >= 0) {
    paramString = rawUrl.slice(hashIndex + 1);
  }
  if (!paramString) {
    const questionIndex = rawUrl.indexOf("?");
    if (questionIndex >= 0) {
      paramString = rawUrl.slice(questionIndex + 1);
    }
  }
  if (!paramString) return null;
  const params = new URLSearchParams(paramString);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return null;
  const expiresAtRaw = params.get("expires_at");
  const expiresAt = expiresAtRaw
    ? new Date(Number(expiresAtRaw) * 1000)
    : undefined;
  const type = params.get("type") ?? "";
  switch (type) {
    case "recovery":
      return expiresAt
        ? { kind: "recovery", accessToken, refreshToken, expiresAt }
        : { kind: "recovery", accessToken, refreshToken };
    case "signup":
      return expiresAt
        ? { kind: "signup", accessToken, refreshToken, expiresAt }
        : { kind: "signup", accessToken, refreshToken };
    case "magiclink":
      return expiresAt
        ? { kind: "magiclink", accessToken, refreshToken, expiresAt }
        : { kind: "magiclink", accessToken, refreshToken };
    case "oauth":
    case "":
      return expiresAt
        ? { kind: "oauth", accessToken, refreshToken, expiresAt }
        : { kind: "oauth", accessToken, refreshToken };
    case "email_change":
      return expiresAt
        ? { kind: "email_change", accessToken, refreshToken, expiresAt }
        : { kind: "email_change", accessToken, refreshToken };
    default:
      return expiresAt
        ? {
            kind: "unknown",
            type,
            accessToken,
            refreshToken,
            expiresAt,
          }
        : { kind: "unknown", type, accessToken, refreshToken };
  }
};

export class DisabledAuthClient implements AuthClient {
  private static readonly reason =
    "Supabase public configuration has not been provided.";

  status(): AuthConfigurationStatus {
    return {
      configured: false,
      provider: "disabled",
      reason: DisabledAuthClient.reason,
    };
  }

  async getSession(): Promise<null> {
    return null;
  }

  async signInWithPassword(
    _credentials: PasswordCredentials,
  ): Promise<AuthSession> {
    throw new IdentityError("AUTH_NOT_CONFIGURED", DisabledAuthClient.reason);
  }

  async signUpWithPassword(
    _credentials: PasswordCredentials,
  ): Promise<SignUpResult> {
    throw new IdentityError("AUTH_NOT_CONFIGURED", DisabledAuthClient.reason);
  }

  async signInWithOAuth(
    _options: OAuthSignInOptions,
  ): Promise<OAuthSignInResult> {
    throw new IdentityError("AUTH_NOT_CONFIGURED", DisabledAuthClient.reason);
  }

  async signInWithIdToken(
    _credentials: IdTokenCredentials,
  ): Promise<AuthSession> {
    throw new IdentityError("AUTH_NOT_CONFIGURED", DisabledAuthClient.reason);
  }

  async signOut(): Promise<void> {}

  async consumeDeepLink(_payload: DeepLinkPayload): Promise<AuthSession> {
    throw new IdentityError("AUTH_NOT_CONFIGURED", DisabledAuthClient.reason);
  }

  async updatePassword(_newPassword: { password: string }): Promise<void> {
    throw new IdentityError("AUTH_NOT_CONFIGURED", DisabledAuthClient.reason);
  }

  async requestPasswordRecovery(_email: { email: string }): Promise<void> {
    throw new IdentityError("AUTH_NOT_CONFIGURED", DisabledAuthClient.reason);
  }

  subscribe(_listener: AuthStateListener): () => void {
    return () => undefined;
  }

  dispose(): void {}
}

export class RejectingAccessTokenVerifier implements AccessTokenVerifier {
  async verify(_accessToken: string): Promise<null> {
    return null;
  }
}
