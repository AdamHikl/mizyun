import type { UserId } from "@mizyun/core";

export interface AuthUser {
  readonly id: UserId;
  readonly email?: string;
}

export interface AuthSession {
  readonly user: AuthUser;
  readonly accessToken: string;
  readonly expiresAt?: Date;
}

export interface AuthPrincipal {
  readonly userId: UserId;
  readonly email?: string;
  readonly role?: string;
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

export type AuthStateListener = (session: AuthSession | null) => void;

export interface AuthClient {
  status(): AuthConfigurationStatus;
  getSession(): Promise<AuthSession | null>;
  signInWithPassword(credentials: PasswordCredentials): Promise<AuthSession>;
  signUpWithPassword(credentials: PasswordCredentials): Promise<SignUpResult>;
  signOut(): Promise<void>;
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

  async signOut(): Promise<void> {}

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
