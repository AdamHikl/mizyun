import { describe, expect, it } from "vitest";
import {
  decryptAppleRevocationToken,
  encryptAppleRevocationToken,
} from "./token-vault.js";

const key = Buffer.alloc(32, 7).toString("base64");
const binding = {
  jobId: "job-a",
  userId: "account-a",
  clientId: "com.mizyun.app",
  subject: "apple-a",
};

describe("Apple revocation token vault", () => {
  it("round trips with fresh nonces and no plaintext retention", () => {
    const first = encryptAppleRevocationToken(
      "private-refresh-token",
      key,
      binding,
    );
    const second = encryptAppleRevocationToken(
      "private-refresh-token",
      key,
      binding,
    );
    expect(first).not.toContain("private-refresh-token");
    expect(first).not.toEqual(second);
    expect(decryptAppleRevocationToken(first, key, binding)).toBe(
      "private-refresh-token",
    );
  });

  it.each(["jobId", "userId", "clientId", "subject"] as const)(
    "rejects replay under another %s",
    (field) => {
      const envelope = encryptAppleRevocationToken(
        "private-refresh-token",
        key,
        binding,
      );
      expect(() =>
        decryptAppleRevocationToken(envelope, key, {
          ...binding,
          [field]: "other",
        }),
      ).toThrow("Apple revocation token protection failed");
    },
  );

  it("rejects tampering, wrong keys and unsupported envelopes without exposing details", () => {
    const envelope = encryptAppleRevocationToken(
      "private-refresh-token",
      key,
      binding,
    );
    const parsed = JSON.parse(envelope);
    const ciphertext = Buffer.from(parsed.ciphertext, "base64url");
    ciphertext[0] = ciphertext[0]! ^ 1;
    const invalid = [
      JSON.stringify({
        ...parsed,
        ciphertext: ciphertext.toString("base64url"),
      }),
      JSON.stringify({
        ...parsed,
        tag: Buffer.alloc(16).toString("base64url"),
      }),
      JSON.stringify({
        ...parsed,
        nonce: Buffer.alloc(11).toString("base64url"),
      }),
      JSON.stringify({ ...parsed, version: 2 }),
      JSON.stringify({ ...parsed, extra: true }),
      "private-refresh-token",
    ];
    for (const value of invalid)
      expect(() => decryptAppleRevocationToken(value, key, binding)).toThrow(
        "Apple revocation token protection failed",
      );
    expect(() =>
      decryptAppleRevocationToken(
        envelope,
        Buffer.alloc(32, 1).toString("base64"),
        binding,
      ),
    ).toThrow("Apple revocation token protection failed");
  });

  it.each([
    "",
    "not-base64",
    Buffer.alloc(31).toString("base64"),
    key.trimEnd() + "\n",
    key.replace("=", ""),
  ])("rejects malformed key configuration before encryption", (value) => {
    expect(() => encryptAppleRevocationToken("token", value, binding)).toThrow(
      "Apple revocation token protection failed",
    );
  });
});
