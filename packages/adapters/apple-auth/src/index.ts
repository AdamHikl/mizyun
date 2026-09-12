export {
  generateAppleClientSecret,
  type GenerateAppleClientSecretOptions,
} from "./client-secret.js";

export {
  createAppleAuthClient,
  DefaultAppleAuthClient,
  type AppleAuthClient,
  type AppleAuthClientOptions,
  type AppleAuthError,
  type AppleAuthErrorKind,
  type AppleTokenResponse,
  type AppleTokenTypeHint,
  type ExchangeAuthorizationCodeInput,
  type RevokeTokenInput,
} from "./apple-client.js";
