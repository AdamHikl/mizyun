import type { ApiClient } from "@mizyun/api-client";
import type { AuthSession } from "@mizyun/identity";
import { isAdultEligibleForCommunity } from "@mizyun/core";
import {
  fetchCommunityProfile,
  fetchCommunityFeed,
} from "@/features/community/community-client";
import {
  coachThreadResponseSchema,
  goalResponseSchema,
  profileResponseSchema,
} from "@mizyun/contracts";
import { fetchWorkoutsHubData } from "@/features/workouts";
import { fetchFoodHistoryWith } from "@/features/log-meal/meal-lifecycle-data";
import { fetchBodyHistoryWith } from "@/features/log-weight/body-history-data";
import { loadCoachWith } from "@/features/coach/coach-data";
import {
  fetchDailySummary,
  fetchEnergySummary,
  fetchLatestWeight,
  fetchNutritionReviewSummaries,
  fetchWorkoutCountForPeriod,
} from "@/features/dashboard/dashboard-data";

const localDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Warm bounded display reads, never AI generation, conversation creation or media creation. */
export async function preloadAppData(
  client: ApiClient,
  session: AuthSession,
  isCurrent: () => boolean,
  now = new Date(),
  birthYear?: number | null,
): Promise<void> {
  const scoped: ApiClient = {
    status: () => client.status(),
    request: (options) =>
      client.request({
        ...options,
        expectedUserId: session.user.id,
        isCurrent,
      }),
  };
  const principal = {
    userId: session.user.id,
    accessToken: session.accessToken,
  };
  const offset = -now.getTimezoneOffset();
  const today = localDate(now);
  const monday = new Date(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const from = localDate(monday);
  const to = localDate(yesterday);
  const warmCommunity = async () => {
    if (
      !isAdultEligibleForCommunity(birthYear, now.getUTCFullYear()) ||
      !isCurrent()
    )
      return;
    const membership = await fetchCommunityProfile(scoped);
    if (membership.ok && membership.value.status === "active" && isCurrent()) {
      await fetchCommunityFeed(scoped, { limit: 20 });
    }
  };
  const warmCoach = async () => {
    const result = await loadCoachWith(scoped);
    if (!result.ok || !result.status.ready || !isCurrent()) return;
    const latest = result.conversations[0];
    if (latest)
      await scoped.request({
        method: "GET",
        path: `/v1/coach/conversations/${encodeURIComponent(latest.id)}`,
        schema: coachThreadResponseSchema,
      });
  };
  await Promise.allSettled([
    warmCommunity(),
    warmCoach(),
    fetchWorkoutsHubData(scoped),
    fetchFoodHistoryWith(scoped, offset, now),
    fetchFoodHistoryWith(scoped, offset, now, { limit: 5 }),
    fetchBodyHistoryWith(scoped),
    fetchDailySummary(scoped, principal, {
      date: today,
      utcOffsetMinutes: offset,
    }),
    fetchLatestWeight(scoped, principal),
    fetchEnergySummary(scoped, principal, offset),
    fetchWorkoutCountForPeriod(scoped, principal, {
      fromIsoDate: from,
      toIsoDate: today,
    }),
    ...(from <= to
      ? [
          fetchNutritionReviewSummaries(scoped, principal, {
            fromIsoDate: from,
            toIsoDate: to,
            utcOffsetMinutes: offset,
          }),
        ]
      : []),
    scoped.request({
      method: "GET",
      path: "/v1/goals/active",
      schema: goalResponseSchema,
    }),
    scoped.request({
      method: "GET",
      path: "/v1/profile",
      schema: profileResponseSchema,
    }),
  ]);
}
