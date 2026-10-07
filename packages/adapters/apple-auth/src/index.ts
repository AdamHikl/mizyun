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

export {
  verifyAppleIdentityToken,
  type VerifyAppleIdentityTokenOptions,
} from "./token-verification.js";
export {
  encryptAppleRevocationToken,
  decryptAppleRevocationToken,
  type AppleRevocationTokenBinding,
} from "./token-vault.js";
