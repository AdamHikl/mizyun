import { createPrivateKey, createSign, type KeyObject } from "node:crypto";

export interface GenerateAppleClientSecretOptions {
  readonly teamId: string;
  readonly keyId: string;
  readonly clientId: string;
  readonly privateKey: string | KeyObject;
  readonly nowSeconds?: number | undefined;
  readonly expiresInSeconds?: number | undefined;
}

const DEFAULT_EXPIRATION_SECONDS = 180 * 86400; // 180 days (~6 months)
const MAX_EXPIRATION_SECONDS = 15777000; // Apple max 6 months

/**
 * Generates an Apple Client Secret (ES256 signed JWT) for use with Apple's REST auth endpoints.
 * Follows Apple specifications:
 * - Header: { alg: "ES256", kid: keyId }
 * - Claims: iss (teamId), iat (nowSeconds), exp (iat + expiresInSeconds), aud ("https://appleid.apple.com"), sub (clientId)
 * - Algorithm: ECDSA using P-256 and SHA-256, IEEE P1363 signature encoding, base64url.
 */
export function generateAppleClientSecret(
  options: GenerateAppleClientSecretOptions,
): string {
  if (!options.teamId || typeof options.teamId !== "string") {
    throw new TypeError("teamId must be a non-empty string");
  }
  if (!options.keyId || typeof options.keyId !== "string") {
    throw new TypeError("keyId must be a non-empty string");
  }
  if (!options.clientId || typeof options.clientId !== "string") {
    throw new TypeError("clientId must be a non-empty string");
  }
  if (!options.privateKey) {
    throw new TypeError("privateKey is required");
  }

  const expiresIn = options.expiresInSeconds ?? DEFAULT_EXPIRATION_SECONDS;
  if (expiresIn <= 0 || expiresIn > MAX_EXPIRATION_SECONDS) {
    throw new RangeError(
      `expiresInSeconds must be between 1 and ${MAX_EXPIRATION_SECONDS} seconds`,
    );
  }

  const iat = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const exp = iat + expiresIn;

  const header = {
    alg: "ES256",
    kid: options.keyId,
  };

  const payload = {
    iss: options.teamId,
    iat,
    exp,
    aud: "https://appleid.apple.com",
    sub: options.clientId,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    "base64url",
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  let privateKeyObject: KeyObject;
  if (typeof options.privateKey === "string") {
    let pem = options.privateKey.includes("\\n")
      ? options.privateKey.replace(/\\n/g, "\n")
      : options.privateKey;
    if (
      pem.includes("-----BEGIN PRIVATE KEY-----") &&
      !pem.includes("-----BEGIN PRIVATE KEY-----\n")
    ) {
      pem = pem.replace(
        "-----BEGIN PRIVATE KEY-----",
        "-----BEGIN PRIVATE KEY-----\n",
      );
    }
    if (
      pem.includes("-----END PRIVATE KEY-----") &&
      !pem.includes("\n-----END PRIVATE KEY-----")
    ) {
      pem = pem.replace(
        "-----END PRIVATE KEY-----",
        "\n-----END PRIVATE KEY-----\n",
      );
    }
    privateKeyObject = createPrivateKey(pem);
  } else {
    privateKeyObject = options.privateKey;
  }

  const signer = createSign("SHA256");
  signer.update(signingInput);
  const signature = signer.sign({
    key: privateKeyObject,
    dsaEncoding: "ieee-p1363",
  });

  const encodedSignature = signature.toString("base64url");
  return `${signingInput}.${encodedSignature}`;
}
