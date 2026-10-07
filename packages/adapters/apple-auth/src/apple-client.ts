import { err, ok, type Result } from "@mizyun/core";

import { readBoundedAppleResponse } from "./token-verification.js";

export type AppleAuthErrorKind =
  | "validation_error"
  | "http_error"
  | "network_error"
  | "timeout"
  | "invalid_response";

export interface AppleAuthError {
  readonly kind: AppleAuthErrorKind;
  readonly message: string;
  readonly status?: number | undefined;
  readonly error?: string | undefined;
  readonly errorDescription?: string | undefined;
  readonly cause?: unknown;
}

export interface AppleTokenResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly idToken: string;
  readonly expiresIn: number;
}

export interface ExchangeAuthorizationCodeInput {
  readonly code: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri?: string | undefined;
}

export type AppleTokenTypeHint = "access_token" | "refresh_token";

export interface RevokeTokenInput {
  readonly token: string;
  readonly tokenTypeHint?: AppleTokenTypeHint | undefined;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface AppleAuthClientOptions {
  readonly baseUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly fetch?: typeof globalThis.fetch | undefined;
}

export interface AppleAuthClient {
  exchangeAuthorizationCode(
    input: ExchangeAuthorizationCodeInput,
  ): Promise<Result<AppleTokenResponse, AppleAuthError>>;

  revokeToken(input: RevokeTokenInput): Promise<Result<void, AppleAuthError>>;
}

const DEFAULT_BASE_URL = "https://appleid.apple.com";
const DEFAULT_TIMEOUT_MS = 10000;

interface AppleResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: string;
}

export class DefaultAppleAuthClient implements AppleAuthClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options?: AppleAuthClientOptions) {
    this.baseUrl = (options?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl =
      options?.fetch ?? ((url, init) => globalThis.fetch(url, init));
  }

  async exchangeAuthorizationCode(
    input: ExchangeAuthorizationCodeInput,
  ): Promise<Result<AppleTokenResponse, AppleAuthError>> {
    if (
      !input.code ||
      typeof input.code !== "string" ||
      input.code.trim().length === 0
    ) {
      return err({
        kind: "validation_error",
        message: "Missing or empty 'code' parameter",
      });
    }
    if (
      !input.clientId ||
      typeof input.clientId !== "string" ||
      input.clientId.trim().length === 0
    ) {
      return err({
        kind: "validation_error",
        message: "Missing or empty 'clientId' parameter",
      });
    }
    if (
      !input.clientSecret ||
      typeof input.clientSecret !== "string" ||
      input.clientSecret.trim().length === 0
    ) {
      return err({
        kind: "validation_error",
        message: "Missing or empty 'clientSecret' parameter",
      });
    }

    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    });
    if (input.redirectUri) {
      params.set("redirect_uri", input.redirectUri);
    }

    const endpoint = `${this.baseUrl}/auth/token`;
    const responseResult = await this.postForm(endpoint, params);
    if (!responseResult.ok) {
      return responseResult;
    }

    const response = responseResult.value;
    if (!response.ok) {
      return this.handleHttpError(response);
    }

    const bodyText = response.body;

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return err({
        kind: "invalid_response",
        message: "Failed to parse token response as JSON",
      });
    }

    if (typeof parsed !== "object" || parsed === null) {
      return err({
        kind: "invalid_response",
        message: "Token response must be an object",
      });
    }

    const record = parsed as Record<string, unknown>;
    const accessToken = record["access_token"];
    const refreshToken = record["refresh_token"];
    const idToken = record["id_token"];
    const expiresIn = record["expires_in"];

    if (
      typeof accessToken !== "string" ||
      !accessToken.trim() ||
      typeof refreshToken !== "string" ||
      !refreshToken.trim() ||
      typeof idToken !== "string" ||
      !idToken.trim() ||
      typeof expiresIn !== "number" ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      return err({
        kind: "invalid_response",
        message:
          "Missing or invalid token fields in Apple response (access_token, refresh_token, id_token, expires_in)",
      });
    }

    return ok({
      accessToken,
      refreshToken,
      idToken,
      expiresIn,
    });
  }

  async revokeToken(
    input: RevokeTokenInput,
  ): Promise<Result<void, AppleAuthError>> {
    if (
      !input.token ||
      typeof input.token !== "string" ||
      input.token.trim().length === 0
    ) {
      return err({
        kind: "validation_error",
        message: "Missing or empty 'token' parameter",
      });
    }
    if (
      !input.clientId ||
      typeof input.clientId !== "string" ||
      input.clientId.trim().length === 0
    ) {
      return err({
        kind: "validation_error",
        message: "Missing or empty 'clientId' parameter",
      });
    }
    if (
      !input.clientSecret ||
      typeof input.clientSecret !== "string" ||
      input.clientSecret.trim().length === 0
    ) {
      return err({
        kind: "validation_error",
        message: "Missing or empty 'clientSecret' parameter",
      });
    }
    if (
      input.tokenTypeHint !== undefined &&
      input.tokenTypeHint !== "access_token" &&
      input.tokenTypeHint !== "refresh_token"
    ) {
      return err({
        kind: "validation_error",
        message:
          "Invalid 'tokenTypeHint' parameter (must be 'access_token' or 'refresh_token')",
      });
    }

    const params = new URLSearchParams({
      token: input.token,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    });
    if (input.tokenTypeHint) {
      params.set("token_type_hint", input.tokenTypeHint);
    }

    const endpoint = `${this.baseUrl}/auth/revoke`;
    const responseResult = await this.postForm(endpoint, params);
    if (!responseResult.ok) {
      return responseResult;
    }

    const response = responseResult.value;
    if (!response.ok) {
      return this.handleHttpError(response);
    }

    return ok(undefined);
  }

  private async postForm(
    endpoint: string,
    params: URLSearchParams,
  ): Promise<Result<AppleResponse, AppleAuthError>> {
    try {
      return ok(
        await readBoundedAppleResponse(
          this.fetchImpl,
          endpoint,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: params.toString(),
          },
          this.timeoutMs,
        ),
      );
    } catch (cause: unknown) {
      if (
        cause instanceof Error &&
        (cause.message === "Apple request timed out" ||
          cause.name === "TimeoutError" ||
          cause.name === "AbortError")
      ) {
        return err({
          kind: "timeout",
          message: "Apple auth request timed out",
        });
      }
      return err({
        kind: "network_error",
        message: "Apple auth request failed",
      });
    }
  }

  private async handleHttpError(
    response: AppleResponse,
  ): Promise<Result<never, AppleAuthError>> {
    return err({
      kind: "http_error",
      status: response.status,
      message: "Apple auth request failed",
    });
  }
}

export function createAppleAuthClient(
  options?: AppleAuthClientOptions,
): AppleAuthClient {
  return new DefaultAppleAuthClient(options);
}
