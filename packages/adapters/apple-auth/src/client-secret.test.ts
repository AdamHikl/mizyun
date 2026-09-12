import {
  createPrivateKey,
  createVerify,
  generateKeyPairSync,
} from "node:crypto";
import { describe, expect, it } from "vitest";

import { generateAppleClientSecret } from "./client-secret.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

describe("generateAppleClientSecret", () => {
  const baseOptions = {
    teamId: "TEAM123456",
    keyId: "KEY1234567",
    clientId: "com.mizyun.app",
    privateKey,
  };

  it("generates a valid signed ES256 JWT with correct headers and claims", () => {
    const nowSeconds = 1700000000;
    const token = generateAppleClientSecret({
      ...baseOptions,
      nowSeconds,
      expiresInSeconds: 3600,
    });

    const parts = token.split(".");
    expect(parts.length).toBe(3);

    const [headerB64, payloadB64, signatureB64] = parts as [
      string,
      string,
      string,
    ];

    const header = JSON.parse(
      Buffer.from(headerB64, "base64url").toString("utf-8"),
    );
    expect(header).toEqual({
      alg: "ES256",
      kid: "KEY1234567",
    });

    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8"),
    );
    expect(payload).toEqual({
      iss: "TEAM123456",
      iat: 1700000000,
      exp: 1700003600,
      aud: "https://appleid.apple.com",
      sub: "com.mizyun.app",
    });

    // Verify cryptographic signature with IEEE P1363 encoding
    const verifier = createVerify("SHA256");
    verifier.update(`${headerB64}.${payloadB64}`);
    const isValid = verifier.verify(
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signatureB64, "base64url"),
    );
    expect(isValid).toBe(true);
  });

  it("defaults nowSeconds to current timestamp and expiration to 180 days", () => {
    const beforeSec = Math.floor(Date.now() / 1000);
    const token = generateAppleClientSecret(baseOptions);
    const afterSec = Math.floor(Date.now() / 1000);

    const parts = token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf-8"),
    );

    expect(payload.iat).toBeGreaterThanOrEqual(beforeSec);
    expect(payload.iat).toBeLessThanOrEqual(afterSec);
    expect(payload.exp).toBe(payload.iat + 180 * 86400);
  });

  it("handles private keys with escaped newlines (\\n)", () => {
    const escapedKey = privateKey.replace(/\n/g, "\\n");
    const token = generateAppleClientSecret({
      ...baseOptions,
      privateKey: escapedKey,
      nowSeconds: 1700000000,
    });

    const parts = token.split(".");
    const verifier = createVerify("SHA256");
    verifier.update(`${parts[0]}.${parts[1]}`);
    const isValid = verifier.verify(
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(parts[2]!, "base64url"),
    );
    expect(isValid).toBe(true);
  });

  it("supports KeyObject instance as privateKey", () => {
    const keyObject = createPrivateKey(privateKey);
    const token = generateAppleClientSecret({
      ...baseOptions,
      privateKey: keyObject,
      nowSeconds: 1700000000,
    });

    const parts = token.split(".");
    const verifier = createVerify("SHA256");
    verifier.update(`${parts[0]}.${parts[1]}`);
    const isValid = verifier.verify(
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(parts[2]!, "base64url"),
    );
    expect(isValid).toBe(true);
  });

  it("validates required parameters and throws TypeError", () => {
    expect(() =>
      generateAppleClientSecret({ ...baseOptions, teamId: "" }),
    ).toThrow(TypeError);

    expect(() =>
      generateAppleClientSecret({ ...baseOptions, keyId: "" }),
    ).toThrow(TypeError);

    expect(() =>
      generateAppleClientSecret({ ...baseOptions, clientId: "" }),
    ).toThrow(TypeError);

    expect(() =>
      generateAppleClientSecret({ ...baseOptions, privateKey: "" as any }),
    ).toThrow(TypeError);
  });

  it("validates expiresInSeconds range and throws RangeError", () => {
    expect(() =>
      generateAppleClientSecret({ ...baseOptions, expiresInSeconds: 0 }),
    ).toThrow(RangeError);

    expect(() =>
      generateAppleClientSecret({ ...baseOptions, expiresInSeconds: -10 }),
    ).toThrow(RangeError);

    expect(() =>
      generateAppleClientSecret({
        ...baseOptions,
        expiresInSeconds: 15777001,
      }),
    ).toThrow(RangeError);
  });
});
