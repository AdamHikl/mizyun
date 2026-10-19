import type { ApiClient } from "@mizyun/api-client";
import {
  activityDraftResponseSchema,
  type ActivityDraft,
  type ActivityDraftResponse,
} from "@mizyun/contracts";
import {
  resolveActivityName,
  type ActivityDescriptionDraft,
} from "@mizyun/core";

/**
 * Why an AI draft was not used. The screen falls back to the on-device
 * parser in every case and says why when it matters to the user.
 */
export type ActivityAiDraftFailure =
  /** Today's shared AI draft budget is used up. */
  | "limit"
  /** Offline, a provider failure, or AI drafting is unavailable. */
  | "unavailable"
  /** The server refused the text (for example, instructions or advice). */
  | "rejected";

export type ActivityAiDraftResult =
  | { readonly ok: true; readonly draft: ActivityDescriptionDraft }
  | { readonly ok: false; readonly failure: ActivityAiDraftFailure };

const pad = (value: number): string => String(value).padStart(2, "0");

const parseLocalDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return { year, month, day };
};

const parseLocalTime = (value: string) => {
  const [hour, minute] = value.split(":").map(Number) as [number, number];
  return { hour, minute };
};

/** Map the server draft onto the same shape the on-device parser fills. */
export const toDescriptionDraft = (
  draft: ActivityDraft,
): ActivityDescriptionDraft => {
  const activity =
    draft.activityName === null
      ? null
      : resolveActivityName(draft.activityName);
  return {
    // A sets-and-reps exercise is not logged here; leave the field for the user.
    activity: activity?.kind === "strength" ? null : activity,
    durationSeconds: draft.durationSeconds,
    distance: draft.distance,
    date: draft.date === null ? null : parseLocalDate(draft.date),
    startTime:
      draft.startTime === null ? null : parseLocalTime(draft.startTime),
    endedNow: draft.endedNow,
    environment: draft.environment,
    note: draft.note,
  };
};

export const draftActivityWithAi = async (
  client: ApiClient,
  description: string,
  now: Date,
): Promise<ActivityAiDraftResult> => {
  const result = await client.request<ActivityDraftResponse>({
    method: "POST",
    path: "/v1/activity-drafts/text",
    body: {
      description: description.trim(),
      localDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      localTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    },
    schema: activityDraftResponseSchema,
  });
  if (result.ok) {
    return { ok: true, draft: toDescriptionDraft(result.value.draft) };
  }
  const error = result.error;
  if (error.kind === "http_error") {
    if (error.status === 429 && error.reason === "daily_budget_exhausted") {
      return { ok: false, failure: "limit" };
    }
    if (error.status === 422) return { ok: false, failure: "rejected" };
  }
  return { ok: false, failure: "unavailable" };
};
