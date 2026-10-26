import { describe, expect, it } from "vitest";

import { parseRevenueCatWebhook } from "./webhook-event.js";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-9222-222222222222";
const U3 = "33333333-3333-4333-a333-333333333333";

const uuid = (n: number): string =>
  `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;

describe("parseRevenueCatWebhook", () => {
  it("parses a realistic INITIAL_PURCHASE and ignores unknown fields", () => {
    const parsed = parseRevenueCatWebhook({
      api_version: "1.0",
      event: {
        id: "12345678-AAAA-BBBB-CCCC-123456789012",
        type: "INITIAL_PURCHASE",
        app_user_id: U1,
        original_app_user_id: U1,
        aliases: ["$RCAnonymousID:abc123", U1],
        environment: "PRODUCTION",
        product_id: "mizyun_pro:yearly",
        price: 39.99,
        currency: "USD",
        period_type: "TRIAL",
        subscriber_attributes: { $email: { value: "x@example.com" } },
        event_timestamp_ms: 1700000000000,
      },
    });
    expect(parsed).toEqual({
      id: "12345678-AAAA-BBBB-CCCC-123456789012",
      type: "INITIAL_PURCHASE",
      candidateUserIds: [U1],
    });
  });

  it("collects transferred_from and transferred_to for TRANSFER", () => {
    const parsed = parseRevenueCatWebhook({
      event: {
        id: "t1",
        type: "TRANSFER",
        transferred_from: ["$RCAnonymousID:zzz", U1],
        transferred_to: [U2],
      },
    });
    expect(parsed?.candidateUserIds).toEqual([U1, U2]);
  });

  it("accepts null optional arrays and a missing app_user_id", () => {
    const parsed = parseRevenueCatWebhook({
      event: {
        id: "e",
        type: "TEST",
        original_app_user_id: null,
        aliases: null,
        transferred_from: null,
        transferred_to: null,
        environment: null,
      },
    });
    expect(parsed).toEqual({ id: "e", type: "TEST", candidateUserIds: [] });
  });

  it("drops anonymous, uppercase and malformed ids", () => {
    const parsed = parseRevenueCatWebhook({
      event: {
        id: "e",
        type: "RENEWAL",
        app_user_id: "$RCAnonymousID:0123456789abcdef0123456789abcdef",
        original_app_user_id: "ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF",
        aliases: [
          "not-a-uuid",
          "11111111-1111-4111-8111-11111111111",
          "11111111-1111-9111-8111-111111111111",
          "11111111-1111-4111-c111-111111111111",
          ` ${U2}`,
          U3,
        ],
      },
    });
    expect(parsed?.candidateUserIds).toEqual([U3]);
  });

  it("dedupes while keeping first-seen order", () => {
    const parsed = parseRevenueCatWebhook({
      event: {
        id: "e",
        type: "RENEWAL",
        app_user_id: U2,
        original_app_user_id: U1,
        aliases: [U1, U2, U2],
        transferred_to: [U1],
      },
    });
    expect(parsed?.candidateUserIds).toEqual([U2, U1]);
  });

  it("caps candidates at 10", () => {
    const aliases = Array.from({ length: 30 }, (_, i) => uuid(i + 1));
    const parsed = parseRevenueCatWebhook({
      event: { id: "e", type: "TRANSFER", aliases },
    });
    expect(parsed?.candidateUserIds).toEqual(aliases.slice(0, 10));
  });

  it.each([
    ["missing id", { event: { type: "RENEWAL" } }],
    ["missing type", { event: { id: "e" } }],
    ["empty id", { event: { id: "", type: "RENEWAL" } }],
    ["empty type", { event: { id: "e", type: "" } }],
    ["no event", { api_version: "1.0" }],
    ["event not an object", { event: "RENEWAL" }],
  ])("returns null for %s", (_name, body) => {
    expect(parseRevenueCatWebhook(body)).toBeNull();
  });

  it("reads identity leniently: oversized or malformed aliases never reject the event", () => {
    const event = parseRevenueCatWebhook({
      event: {
        id: "e",
        type: "T",
        aliases: [...Array(101).fill(U1), "x".repeat(500), 7, null],
        transferred_from: "not-an-array",
        environment: "X".repeat(100),
      },
    });
    expect(event).toEqual({ id: "e", type: "T", candidateUserIds: [U1] });
  });

  it.each([null, undefined, "text", 42, [], true])(
    "returns null for non-object body %j",
    (body) => {
      expect(parseRevenueCatWebhook(body)).toBeNull();
    },
  );
});
