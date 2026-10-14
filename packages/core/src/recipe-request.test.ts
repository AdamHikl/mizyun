import { describe, expect, it } from "vitest";
import {
  assertRecipeRequestReservation,
  type ReserveRecipeRequest,
} from "./recipe-request";
import type { UserId } from "./index";
const request: ReserveRecipeRequest = {
  userId: "80000000-0000-4000-8000-000000000001" as UserId,
  requestId: "80000000-0000-4000-8000-000000000002",
  operation: "suggest",
  fingerprint: "a".repeat(64),
  consentVersion: "2026-09-08",
  tokensEstimated: 5000,
  limits: {
    dailyTokenBudget: 20000,
    dailyDraftLimit: 5,
    requestsPerMinute: 3,
    maxConcurrentRequests: 1,
  },
  leaseMs: 60000,
};
describe("recipe reservation boundary", () => {
  it("accepts an explicit non-conversation identity with bounded accounting", () =>
    expect(() => assertRecipeRequestReservation(request)).not.toThrow());
  it.each([
    { requestId: "not-a-uuid" },
    { fingerprint: "raw health context" },
    { tokensEstimated: 0 },
    { tokensEstimated: 1.5 },
    { tokensEstimated: 2000001 },
    { leaseMs: 90001 },
    { consentVersion: "" },
    { limits: { ...request.limits, maxConcurrentRequests: 0 } },
  ])(
    "rejects invalid metadata before any gate or provider call: %j",
    (change) => {
      expect(() =>
        assertRecipeRequestReservation({ ...request, ...change }),
      ).toThrow("Invalid recipe request reservation");
    },
  );
});
