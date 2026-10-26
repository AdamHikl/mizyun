import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  signRevenueCatWebhook,
  verifyRevenueCatWebhook,
} from "./webhook-signature.js";

const SECRET = "whsec_test_secret";
const NOW = new Date("2026-10-26T12:00:00.000Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
const BODY = Buffer.from(
  JSON.stringify({ event: { id: "e1", type: "RENEWAL" } }),
);

const verify = (
  overrides: Partial<Parameters<typeof verifyRevenueCatWebhook>[0]> = {},
) =>
  verifyRevenueCatWebhook({
    rawBody: BODY,
    signatureHeader: signRevenueCatWebhook(BODY, SECRET, NOW_S),
    authorizationHeader: undefined,
    signingSecret: SECRET,
    expectedAuthorization: null,
    now: NOW,
    ...overrides,
  });

const digest = (body: Buffer, secret: string, t: number): string =>
  createHmac("sha256", secret).update(`${t}.`).update(body).digest("hex");

describe("verifyRevenueCatWebhook", () => {
  it("accepts a header produced by signRevenueCatWebhook", () => {
    expect(verify()).toEqual({ ok: true });
  });

  it("produces the documented header format", () => {
    expect(signRevenueCatWebhook(BODY, SECRET, 123)).toBe(
      `t=123,v1=${digest(BODY, SECRET, 123)}`,
    );
  });

  it("rejects a different signing secret", () => {
    expect(verify({ signingSecret: "other" })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a body changed by a single byte", () => {
    const tampered = Buffer.from(BODY);
    tampered.writeUInt8(
      tampered.readUInt8(tampered.length - 2) ^ 1,
      tampered.length - 2,
    );
    expect(verify({ rawBody: tampered })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a valid signature whose timestamp was rewritten", () => {
    const sig = digest(BODY, SECRET, NOW_S);
    expect(verify({ signatureHeader: `t=${NOW_S + 1},v1=${sig}` })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it.each([-300, 300])("accepts a timestamp exactly %i seconds away", (d) => {
    expect(
      verify({
        signatureHeader: signRevenueCatWebhook(BODY, SECRET, NOW_S + d),
      }),
    ).toEqual({ ok: true });
  });

  it.each([-301, 301])("rejects a timestamp %i seconds away", (d) => {
    expect(
      verify({
        signatureHeader: signRevenueCatWebhook(BODY, SECRET, NOW_S + d),
      }),
    ).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("honours a custom tolerance", () => {
    const header = signRevenueCatWebhook(BODY, SECRET, NOW_S - 10);
    expect(verify({ signatureHeader: header, toleranceSeconds: 10 })).toEqual({
      ok: true,
    });
    expect(verify({ signatureHeader: header, toleranceSeconds: 9 })).toEqual({
      ok: false,
      reason: "stale_timestamp",
    });
  });

  it("reports a missing header", () => {
    expect(verify({ signatureHeader: undefined })).toEqual({
      ok: false,
      reason: "missing_signature",
    });
    expect(verify({ signatureHeader: "" })).toEqual({
      ok: false,
      reason: "missing_signature",
    });
  });

  const good = digest(BODY, SECRET, NOW_S);
  it.each([
    ["no t", `v1=${good}`],
    ["no v1", `t=${NOW_S}`],
    ["non-hex v1", `t=${NOW_S},v1=${"z".repeat(64)}`],
    ["short v1", `t=${NOW_S},v1=${good.slice(0, 62)}`],
    ["long v1", `t=${NOW_S},v1=${good}00`],
    ["non-numeric t", `t=abc,v1=${good}`],
    ["negative t", `t=-5,v1=${good}`],
    ["junk part without equals", `t=${NOW_S},junk,v1=${good}`],
    ["leading equals", `t=${NOW_S},=x,v1=${good}`],
    ["garbage", "not a signature"],
  ])("rejects a malformed header: %s", (_name, header) => {
    expect(verify({ signatureHeader: header })).toEqual({
      ok: false,
      reason: "malformed_signature",
    });
  });

  it("ignores unknown well-formed keys", () => {
    expect(
      verify({ signatureHeader: `t=${NOW_S},v0=whatever,v1=${good}` }),
    ).toEqual({ ok: true });
  });

  it("accepts when any one of several v1 values matches", () => {
    const wrong = digest(BODY, "other", NOW_S);
    expect(
      verify({ signatureHeader: `t=${NOW_S},v1=${wrong},v1=${good}` }),
    ).toEqual({ ok: true });
    expect(
      verify({ signatureHeader: `t=${NOW_S},v1=${good},v1=${wrong}` }),
    ).toEqual({ ok: true });
  });

  it("rejects when none of several v1 values match", () => {
    const a = digest(BODY, "a", NOW_S);
    const b = digest(BODY, "b", NOW_S);
    expect(verify({ signatureHeader: `t=${NOW_S},v1=${a},v1=${b}` })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("accepts uppercase hex and whitespace around parts", () => {
    expect(
      verify({ signatureHeader: `t=${NOW_S}, v1=${good.toUpperCase()}` }),
    ).toEqual({ ok: true });
  });

  describe("Authorization header", () => {
    it("is not required when expectedAuthorization is null", () => {
      expect(verify({ authorizationHeader: "anything" })).toEqual({ ok: true });
    });

    it("accepts an exact match", () => {
      expect(
        verify({
          expectedAuthorization: "Bearer abc",
          authorizationHeader: "Bearer abc",
        }),
      ).toEqual({ ok: true });
    });

    it("rejects a mismatch, a prefix, and a missing header", () => {
      for (const header of [
        "Bearer abd",
        "Bearer ab",
        "Bearer abc ",
        undefined,
      ]) {
        expect(
          verify({
            expectedAuthorization: "Bearer abc",
            authorizationHeader: header,
          }),
        ).toEqual({ ok: false, reason: "bad_authorization" });
      }
    });

    it("rejects a bad authorization even with a valid signature", () => {
      expect(
        verify({
          expectedAuthorization: "secret",
          authorizationHeader: undefined,
        }).ok,
      ).toBe(false);
    });
  });
});
