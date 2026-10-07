import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { verifyAppleIdentityToken } from "./token-verification.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  alg: "RS256",
  use: "sig",
  kid: "apple-key",
};
const claims = {
  iss: "https://appleid.apple.com",
  aud: "com.mizyun.app",
  sub: "apple-subject",
  iat: 900,
  exp: 1100,
};
function token(
  payload: Record<string, unknown> = claims,
  header: Record<string, unknown> = { alg: "RS256", kid: "apple-key" },
) {
  const input = [header, payload]
    .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
    .join(".");
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}
const options = { clientId: claims.aud, subject: claims.sub, now: 1000 };
function keysFetch(keys: unknown[] = [jwk]) {
  return vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(JSON.stringify({ keys })));
}

describe("Apple identity verification", () => {
  it("checks a real RSA signature against a matching Apple key from the fixed endpoint", async () => {
    const fetch = keysFetch();
    await expect(
      verifyAppleIdentityToken(token(), { ...options, fetch }),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      "https://appleid.apple.com/auth/keys",
      expect.objectContaining({
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    { aud: "other-client" },
    { aud: [claims.aud] },
    { sub: "other-account" },
    { iss: "https://attacker.example" },
    { exp: 1000 },
    { exp: "1100" },
    { iat: 1001 },
    { iat: -1 },
    { iat: undefined },
    { nbf: 1001 },
  ])(
    "rejects invalid or mismatched claims before contacting Apple: %j",
    async (change) => {
      const fetch = keysFetch();
      await expect(
        verifyAppleIdentityToken(token({ ...claims, ...change }), {
          ...options,
          fetch,
        }),
      ).rejects.toThrow("Apple identity verification failed");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    { alg: "none", kid: "apple-key" },
    { alg: "HS256", kid: "apple-key" },
    { alg: "RS256" },
    { alg: "RS256", kid: "apple-key", crit: ["unknown"] },
  ])("rejects unsupported JOSE headers", async (header) => {
    const fetch = keysFetch();
    await expect(
      verifyAppleIdentityToken(token(claims, header), { ...options, fetch }),
    ).rejects.toThrow("Apple identity verification failed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects forged signatures and unknown or duplicate signing keys", async () => {
    const valid = token();
    const segments = valid.split(".");
    const signature = Buffer.from(segments[2]!, "base64url");
    signature[0] = signature[0]! ^ 1;
    await expect(
      verifyAppleIdentityToken(
        `${segments[0]}.${segments[1]}.${signature.toString("base64url")}`,
        { ...options, fetch: keysFetch() },
      ),
    ).rejects.toThrow("Apple identity verification failed");
    for (const keys of [
      [],
      [jwk, jwk],
      [{ ...jwk, alg: "HS256" }],
      [{ ...jwk, kid: "different" }],
    ]) {
      await expect(
        verifyAppleIdentityToken(valid, { ...options, fetch: keysFetch(keys) }),
      ).rejects.toThrow("Apple identity verification failed");
    }
  });

  it("bounds streamed JWKS bodies rather than trusting content-length", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("x".repeat(65537)));
    await expect(
      verifyAppleIdentityToken(token(), { ...options, fetch }),
    ).rejects.toThrow("Apple identity verification failed");
  });

  it("times out a stalled body and a fetch that ignores abort without exposing provider errors", async () => {
    const stalledBody = new Response(
      new ReadableStream<Uint8Array>({ start() {} }),
    );
    for (const fetch of [
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(stalledBody),
      vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(() => new Promise(() => {})),
    ]) {
      await expect(
        verifyAppleIdentityToken(token(), { ...options, fetch, timeoutMs: 5 }),
      ).rejects.toThrow("Apple identity verification failed");
    }
    await expect(
      verifyAppleIdentityToken(token(), {
        ...options,
        fetch: vi.fn().mockRejectedValue(new Error("secret-id-token")),
      }),
    ).rejects.toThrow(/^Apple identity verification failed$/);
  });
});
