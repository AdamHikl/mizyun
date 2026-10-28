import { describe, expect, it } from "vitest";
import {
  AI_CONSENT_VERSIONS_DISCLOSING_ANTHROPIC,
  CURRENT_AI_CONSENT_VERSION,
  DEFAULT_ACCEPTED_AI_CONSENT_VERSIONS,
  LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
  accountExportSchema,
  aiConsentDisclosesAnthropic,
  updateAiConsentSchema,
  CURRENT_HEALTH_DATA_CONSENT_VERSION,
  isHealthDataConsentCurrent,
  updateHealthDataConsentSchema,
} from "./account.js";
import {
  latestAdultBirthYear,
  profilePatchSchema,
  profileSchema,
} from "./index.js";

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
  it("lets only the two-provider disclosures route to Anthropic", () => {
    expect(AI_CONSENT_VERSIONS_DISCLOSING_ANTHROPIC).toEqual([
      "2026-10-20",
      "2026-10-21",
    ]);
    expect(aiConsentDisclosesAnthropic("2026-10-20")).toBe(true);
    expect(aiConsentDisclosesAnthropic(CURRENT_AI_CONSENT_VERSION)).toBe(true);
    for (const version of [
      LEGACY_AI_CONSENT_VERSION_GEMINI_ONLY,
      "2026-10-22",
      "",
      null,
      undefined,
    ]) {
      expect(aiConsentDisclosesAnthropic(version)).toBe(false);
    }
  });
});

describe("health data consent contract (PRIV-01)", () => {
  it("treats only a granted, unrevoked, current-version consent as current", () => {
    const base = {
      granted: true,
      consentVersion: CURRENT_HEALTH_DATA_CONSENT_VERSION,
      revokedAt: null,
    };
    expect(isHealthDataConsentCurrent(base)).toBe(true);
    expect(isHealthDataConsentCurrent(null)).toBe(false);
    expect(isHealthDataConsentCurrent({ ...base, granted: false })).toBe(false);
    expect(
      isHealthDataConsentCurrent({
        ...base,
        revokedAt: "2026-10-27T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      isHealthDataConsentCurrent({ ...base, consentVersion: "2026-01-01" }),
    ).toBe(false);
  });

  it("rejects unknown fields in the consent update body", () => {
    expect(
      updateHealthDataConsentSchema.safeParse({
        granted: true,
        consentVersion: CURRENT_HEALTH_DATA_CONSENT_VERSION,
        userId: "someone-else",
      }).success,
    ).toBe(false);
  });
});

describe("adult-only profile writes (PRIV-02)", () => {
  it("rejects an under-18 birth year but still reads older stored profiles", () => {
    const latest = latestAdultBirthYear();
    expect(profilePatchSchema.safeParse({ birthYear: latest }).success).toBe(
      true,
    );
    expect(
      profilePatchSchema.safeParse({ birthYear: latest + 1 }).success,
    ).toBe(false);
    expect(profilePatchSchema.safeParse({ birthYear: null }).success).toBe(
      true,
    );
    expect(profileSchema.shape.birthYear.safeParse(latest + 1).success).toBe(
      true,
    );
  });
});
