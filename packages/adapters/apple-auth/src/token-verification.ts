import {
  constants,
  createPublicKey,
  verify,
  type JsonWebKey,
} from "node:crypto";

export interface VerifyAppleIdentityTokenOptions {
  readonly clientId: string;
  readonly subject: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Unix seconds, for deterministic verification tests. */
  readonly now?: number;
  readonly timeoutMs?: number;
}

const APPLE_ISSUER = "https://appleid.apple.com";
const MAX_RESPONSE_BYTES = 65536;
const VERIFICATION_ERROR = "Apple identity verification failed";

/** Internal shared transport guard: includes headers and the entire streamed body. */
export async function readBoundedAppleResponse(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{
  readonly status: number;
  readonly ok: boolean;
  readonly body: string;
}> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) {
    throw new Error("Apple request failed");
  }
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const operation = async () => {
    const response = await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      if (response.body) void response.body.cancel().catch(() => undefined);
      throw new Error("Apple request timed out");
    }
    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) ||
        Number(declaredLength) > MAX_RESPONSE_BYTES)
    ) {
      controller.abort();
      throw new Error("Apple response exceeded limit");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (response.body !== null) {
      reader = response.body.getReader();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          controller.abort();
          void reader.cancel().catch(() => undefined);
          throw new Error("Apple response exceeded limit");
        }
        chunks.push(chunk.value);
      }
    }
    return {
      status: response.status,
      ok: response.ok,
      body: Buffer.concat(chunks).toString("utf8"),
    };
  };
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          if (reader) void reader.cancel().catch(() => undefined);
          reject(new Error("Apple request timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(VERIFICATION_ERROR);
  return value as Record<string, unknown>;
}

function decode(segment: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error(VERIFICATION_ERROR);
  const bytes = Buffer.from(segment, "base64url");
  if (bytes.toString("base64url") !== segment)
    throw new Error(VERIFICATION_ERROR);
  return bytes;
}

/** Verifies only Apple's RS256 keys from the fixed Apple JWKS endpoint. */
export async function verifyAppleIdentityToken(
  token: string,
  options: VerifyAppleIdentityTokenOptions,
): Promise<void> {
  try {
    if (
      typeof token !== "string" ||
      token.length > 16384 ||
      !options.clientId.trim() ||
      !options.subject.trim()
    )
      throw new Error(VERIFICATION_ERROR);
    const segments = token.split(".");
    if (segments.length !== 3) throw new Error(VERIFICATION_ERROR);
    const [headerSegment, payloadSegment, signatureSegment] = segments as [
      string,
      string,
      string,
    ];
    const header = object(JSON.parse(decode(headerSegment).toString("utf8")));
    const claims = object(JSON.parse(decode(payloadSegment).toString("utf8")));
    const signature = decode(signatureSegment);
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      header["alg"] !== "RS256" ||
      typeof header["kid"] !== "string" ||
      !header["kid"].trim() ||
      header["kid"].length > 256 ||
      header["crit"] !== undefined ||
      claims["iss"] !== APPLE_ISSUER ||
      claims["aud"] !== options.clientId ||
      claims["sub"] !== options.subject ||
      !Number.isSafeInteger(claims["exp"]) ||
      !Number.isSafeInteger(claims["iat"]) ||
      (claims["exp"] as number) <= now ||
      (claims["iat"] as number) > now ||
      (claims["iat"] as number) < 0 ||
      (claims["exp"] as number) <= (claims["iat"] as number) ||
      (claims["nbf"] !== undefined &&
        (!Number.isSafeInteger(claims["nbf"]) ||
          (claims["nbf"] as number) > now))
    ) {
      throw new Error(VERIFICATION_ERROR);
    }
    const response = await readBoundedAppleResponse(
      options.fetch ?? globalThis.fetch,
      `${APPLE_ISSUER}/auth/keys`,
      { method: "GET", headers: { Accept: "application/json" } },
      options.timeoutMs ?? 10000,
    );
    if (!response.ok) throw new Error(VERIFICATION_ERROR);
    const jwks = object(JSON.parse(response.body));
    if (!Array.isArray(jwks["keys"]) || jwks["keys"].length > 32)
      throw new Error(VERIFICATION_ERROR);
    const matching = jwks["keys"]
      .map(object)
      .filter((key) => key["kid"] === header["kid"]);
    if (matching.length !== 1) throw new Error(VERIFICATION_ERROR);
    const key = matching[0]!;
    if (
      key["kty"] !== "RSA" ||
      key["alg"] !== "RS256" ||
      key["use"] !== "sig" ||
      typeof key["n"] !== "string" ||
      typeof key["e"] !== "string" ||
      key["d"] !== undefined ||
      (key["key_ops"] !== undefined &&
        (!Array.isArray(key["key_ops"]) ||
          key["key_ops"].length !== 1 ||
          key["key_ops"][0] !== "verify"))
    )
      throw new Error(VERIFICATION_ERROR);
    if (decode(key["n"]).length > 1024 || decode(key["e"]).length > 8)
      throw new Error(VERIFICATION_ERROR);
    const publicKey = createPublicKey({
      key: key as JsonWebKey,
      format: "jwk",
    });
    if (
      (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
      !verify(
        "RSA-SHA256",
        Buffer.from(`${headerSegment}.${payloadSegment}`),
        { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
        signature,
      )
    )
      throw new Error(VERIFICATION_ERROR);
  } catch {
    throw new Error(VERIFICATION_ERROR);
  }
}
