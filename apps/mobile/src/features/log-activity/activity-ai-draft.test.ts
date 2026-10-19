import { describe, expect, it, vi } from "vitest";
import type { ApiClient, ApiError } from "@mizyun/api-client";
import type { ActivityDraft } from "@mizyun/contracts";

import { draftActivityWithAi, toDescriptionDraft } from "./activity-ai-draft";

const draft: ActivityDraft = {
  activityName: "Boxing",
  durationSeconds: 2700,
  distance: null,
  date: "2026-10-18",
  startTime: "18:30",
  endedNow: false,
  environment: null,
  note: "Sparring rounds",
  provenance: {
    provider: "gemini",
    model: "gemini-3.8-flash",
    promptVersion: "activity-draft-v1",
  },
};

const clientReturning = (result: unknown) => {
  const request = vi.fn(async () => result);
  const client = {
    status: () => ({ configured: true, baseUrl: "https://api.test" }),
    request,
  } as unknown as ApiClient;
  return { client, request };
};

const failure = (error: ApiError) => ({ ok: false, error });

describe("toDescriptionDraft", () => {
  it("maps an unknown activity to a custom activity and parses date and time", () => {
    expect(toDescriptionDraft(draft)).toEqual({
      activity: { kind: "custom", name: "Boxing" },
      durationSeconds: 2700,
      distance: null,
      date: { year: 2026, month: 10, day: 18 },
      startTime: { hour: 18, minute: 30 },
      endedNow: false,
      environment: null,
      note: "Sparring rounds",
    });
  });

  it("resolves known names to running and catalog activities", () => {
    expect(
      toDescriptionDraft({ ...draft, activityName: "Running" }).activity,
    ).toEqual({ kind: "running", name: "Running" });
    expect(
      toDescriptionDraft({ ...draft, activityName: "Swimming" }).activity,
    ).toMatchObject({ kind: "catalog" });
  });

  it("leaves a sets-and-reps exercise for the user to fill", () => {
    expect(
      toDescriptionDraft({ ...draft, activityName: "Barbell Bench Press" })
        .activity,
    ).toBeNull();
  });

  it("keeps nulls as nulls", () => {
    expect(
      toDescriptionDraft({
        ...draft,
        activityName: null,
        date: null,
        startTime: null,
      }),
    ).toMatchObject({ activity: null, date: null, startTime: null });
  });
});

describe("draftActivityWithAi", () => {
  it("sends the description with the device's local date and time", async () => {
    const { client, request } = clientReturning({
      ok: true,
      value: { draft, requestId: "r" },
    });
    const result = await draftActivityWithAi(
      client,
      "  boxing 45 min yesterday  ",
      new Date(2026, 9, 19, 7, 5),
    );
    expect(result).toMatchObject({ ok: true });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/v1/activity-drafts/text",
        body: {
          description: "boxing 45 min yesterday",
          localDate: "2026-10-19",
          localTime: "07:05",
        },
      }),
    );
  });

  it.each([
    [
      failure({
        kind: "http_error",
        status: 429,
        code: "RATE_LIMITED",
        message: "limit",
        reason: "daily_budget_exhausted",
      }),
      "limit",
    ],
    [
      failure({
        kind: "http_error",
        status: 429,
        code: "RATE_LIMITED",
        message: "slow down",
        reason: "minute_rate_limit",
      }),
      "unavailable",
    ],
    [
      failure({
        kind: "http_error",
        status: 422,
        code: "VALIDATION_ERROR",
        message: "no",
      }),
      "rejected",
    ],
    [
      failure({
        kind: "http_error",
        status: 403,
        code: "AI_CONSENT_REQUIRED",
        message: "consent",
      }),
      "unavailable",
    ],
    [failure({ kind: "network_error", cause: null }), "unavailable"],
    [failure({ kind: "validation_error", issues: [] }), "unavailable"],
  ])("maps a failure to a fallback reason %#", async (response, expected) => {
    const { client } = clientReturning(response);
    await expect(
      draftActivityWithAi(client, "boxing", new Date()),
    ).resolves.toEqual({ ok: false, failure: expected });
  });
});
