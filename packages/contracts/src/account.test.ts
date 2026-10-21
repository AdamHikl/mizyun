import { describe, expect, it } from "vitest";
import {
  CURRENT_AI_CONSENT_VERSION,
  DEFAULT_ACCEPTED_AI_CONSENT_VERSIONS,
  LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
  accountExportSchema,
  updateAiConsentSchema,
} from "./account.js";

const record = {
  requestId: "83000000-0000-4000-8000-000000000002",
  operation: "suggest",
  status: "succeeded",
  createdAt: "2026-10-13T12:00:00.000Z",
  budgetDay: "2026-10-13",
  tokensCharged: 1500,
};
const schema = accountExportSchema.shape.recipeRequests;

describe("content-free recipe request account export", () => {
  it("accepts operational metadata and remains optional for older exports", () => {
    expect(schema.parse([record])).toEqual([record]);
    expect(schema.parse(undefined)).toBeUndefined();
  });
  it.each([
    { prompt: "private" },
    { fingerprint: "private" },
    { attemptId: "private" },
    { operation: "chat" },
    { status: "content" },
    { requestId: "bad" },
    { createdAt: "bad" },
    { budgetDay: "2026-02-30" },
    { tokensCharged: -1 },
    { tokensCharged: 0.5 },
    { tokensCharged: 2_000_001 },
  ])("rejects extra content and malformed accounting: %j", (change) => {
    expect(schema.safeParse([{ ...record, ...change }]).success).toBe(false);
  });
});

describe("AI consent versions", () => {
  it("asks for the Log activity fallback disclosure while accepting both older ones by default", () => {
    expect(CURRENT_AI_CONSENT_VERSION).toBe("2026-10-21");
    expect(LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY).toBe("2026-09-08");
    expect(DEFAULT_ACCEPTED_AI_CONSENT_VERSIONS).toEqual([
      "2026-09-08",
      "2026-10-20",
      "2026-10-21",
    ]);
  });
  it("defaults an omitted consent version to the current disclosure", () => {
    expect(
      updateAiConsentSchema.parse({ granted: true, confirmedAdult: true })
        .consentVersion,
    ).toBe(CURRENT_AI_CONSENT_VERSION);
  });
});
