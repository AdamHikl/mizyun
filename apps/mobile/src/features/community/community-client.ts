import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  activityReactionsResponseSchema,
  authorSharedActivityDtoSchema,
  blockedUserListResponseSchema,
  mutedUserListResponseSchema,
  setCommunityMuteSchema,
  communityBlockDtoSchema,
  communityInvitationListResponseSchema,
  communityProfileDtoSchema,
  communityReportListResponseSchema,
  communityReportResponseSchema,
  createInvitationResponseSchema,
  followRelationshipDtoSchema,
  handleAvailabilityResponseSchema,
  moderationAppealDtoSchema,
  publicCommunityProfileDtoSchema,
  communityProfileViewDtoSchema,
  type CommunityProfileViewDto,
  publishWorkoutActivitySchema,
  mealSharePreviewDtoSchema,
  boulderingSharePreviewDtoSchema,
  relationshipListResponseSchema,
  removeFollowerResponseSchema,
  resolveInvitationResponseSchema,
  revokeInvitationResponseSchema,
  safetyContactInfoSchema,
  searchProfilesResponseSchema,
  sharedActivityFeedItemDtoSchema,
  unblockCommunityResponseSchema,
  unfollowCommunityResponseSchema,
  unpublishActivityResponseSchema,
  updateSharedActivitySchema,
  withdrawCommunityResponseSchema,
  workoutSharePreviewDtoSchema,
  type ActivityReactionsResponse,
  type AuthorSharedActivityDto,
  type BlockedUserListResponse,
  type MutedUserListResponse,
  type CommunityBlockDto,
  type CommunityFeedResponse,
  type CommunityInvitationListResponse,
  type CommunityProfileDto,
  type CommunityReactionKind,
  type CommunityReportListResponse,
  type CommunityReportResponse,
  type CreateCommunityProfileInput,
  type CreateCommunityReportInput,
  type CreateInvitationResponse,
  type CreateModerationAppealInput,
  type FollowRelationshipDto,
  type HandleAvailabilityResponse,
  type ModerationAppealDto,
  type PublicCommunityProfileDto,
  type PublishWorkoutActivityInput,
  type PublishMealActivityInput,
  type MealSharePreviewDto,
  type BoulderingSharePreviewDto,
  type PublishBoulderingActivityInput,
  type ReactorSummary,
  type RelationshipListResponse,
  type RemoveFollowerResponse,
  type ResolveInvitationResponse,
  type RevokeInvitationResponse,
  type SafetyContactInfo,
  type SearchProfilesResponse,
  type SharedActivityFeedItemDto,
  type UnblockCommunityResponse,
  type UnfollowCommunityResponse,
  type UnpublishActivityResponse,
  type UpdateCommunityProfileInput,
  type UpdateSharedActivityInput,
  type WithdrawCommunityResponse,
  type WorkoutSharePreviewDto,
} from "@mizyun/contracts";
import { tolerantCommunityFeedResponseSchema } from "./activity-feed-schema";
import type { Result } from "@mizyun/core";

export type ScopedCommunityClient = ApiClient;
export type CommunityClientError = ApiError;

// ==========================================
// Profile & Identity (COMM-03)
// ==========================================

export async function fetchCommunityProfile(
  client: ApiClient,
): Promise<Result<CommunityProfileDto, ApiError>> {
  return client.request<CommunityProfileDto>({
    method: "GET",
    path: "/v1/community/profile",
    schema: communityProfileDtoSchema,
  });
}

export async function enrollCommunityProfile(
  client: ApiClient,
  input: CreateCommunityProfileInput,
): Promise<Result<CommunityProfileDto, ApiError>> {
  return client.request<CommunityProfileDto>({
    method: "POST",
    path: "/v1/community/profile",
    body: input,
    schema: communityProfileDtoSchema,
  });
}

export async function updateCommunityProfile(
  client: ApiClient,
  input: UpdateCommunityProfileInput,
): Promise<Result<CommunityProfileDto, ApiError>> {
  return client.request<CommunityProfileDto>({
    method: "PATCH",
    path: "/v1/community/profile",
    body: input,
    schema: communityProfileDtoSchema,
  });
}

export async function withdrawCommunityProfile(
  client: ApiClient,
): Promise<Result<WithdrawCommunityResponse, ApiError>> {
  return client.request<WithdrawCommunityResponse>({
    method: "DELETE",
    path: "/v1/community/profile",
    schema: withdrawCommunityResponseSchema,
  });
}

export async function checkHandleAvailability(
  client: ApiClient,
  handle: string,
): Promise<Result<HandleAvailabilityResponse, ApiError>> {
  const query = new URLSearchParams({ handle }).toString();
  return client.request<HandleAvailabilityResponse>({
    method: "GET",
    path: `/v1/community/handles/check?${query}`,
    schema: handleAvailabilityResponseSchema,
  });
}

export async function searchCommunityProfiles(
  client: ApiClient,
  queryText: string,
  limit = 20,
): Promise<Result<SearchProfilesResponse, ApiError>> {
  const query = new URLSearchParams({
    q: queryText,
    limit: String(limit),
  }).toString();
  return client.request<SearchProfilesResponse>({
    method: "GET",
    path: `/v1/community/search?${query}`,
    schema: searchProfilesResponseSchema,
  });
}

export async function fetchPublicCommunityProfile(
  client: ApiClient,
  targetUserId: string,
): Promise<Result<PublicCommunityProfileDto, ApiError>> {
  return client.request<PublicCommunityProfileDto>({
    method: "GET",
    path: `/v1/community/profiles/${encodeURIComponent(targetUserId)}`,
    schema: publicCommunityProfileDtoSchema,
  });
}

/** Full caller-owned directional context is required before profile actions. */
export async function fetchCommunityProfileView(
  client: ApiClient,
  targetUserId: string,
): Promise<Result<CommunityProfileViewDto, ApiError>> {
  return client.request<CommunityProfileViewDto>({
    method: "GET",
    path: `/v1/community/profiles/${encodeURIComponent(targetUserId)}`,
    schema: communityProfileViewDtoSchema,
  });
}

export async function fetchCommunityProfileActivities(
  client: ApiClient,
  targetUserId: string,
  page?: { limit?: number; cursor?: string },
): Promise<Result<CommunityFeedResponse, ApiError>> {
  return client.request<CommunityFeedResponse>({
    method: "GET",
    path: `/v1/community/profiles/${encodeURIComponent(targetUserId)}/activities${communityPageQuery(page)}`,
    schema: tolerantCommunityFeedResponseSchema,
  });
}

// ==========================================
// Relationships & Blocking (COMM-04)
// ==========================================

export async function requestFollow(
  client: ApiClient,
  targetUserId: string,
  invitationToken: string | undefined,
  operationId: string,
): Promise<Result<FollowRelationshipDto, ApiError>> {
  return client.request<FollowRelationshipDto>({
    method: "POST",
    path: "/v1/community/relationships/follow",
    body: {
      targetUserId,
      ...(invitationToken ? { invitationToken } : {}),
      ...(operationId ? { operationId } : {}),
    },
    schema: followRelationshipDtoSchema,
  });
}

export async function respondToFollowRequest(
  client: ApiClient,
  relationshipId: string,
  action: "approve" | "decline" | "cancel",
): Promise<Result<FollowRelationshipDto, ApiError>> {
  return client.request<FollowRelationshipDto>({
    method: "PUT",
    path: `/v1/community/relationships/${encodeURIComponent(relationshipId)}`,
    body: { action },
    schema: followRelationshipDtoSchema,
  });
}

export async function unfollowUser(
  client: ApiClient,
  targetUserId: string,
  relationshipId?: string,
): Promise<Result<UnfollowCommunityResponse, ApiError>> {
  return client.request<UnfollowCommunityResponse>({
    method: "DELETE",
    path: `/v1/community/relationships/following/${encodeURIComponent(targetUserId)}${relationshipId ? `?${new URLSearchParams({ relationshipId })}` : ""}`,
    schema: unfollowCommunityResponseSchema,
  });
}

export async function removeFollower(
  client: ApiClient,
  followerUserId: string,
  relationshipId?: string,
): Promise<Result<RemoveFollowerResponse, ApiError>> {
  return client.request<RemoveFollowerResponse>({
    method: "DELETE",
    path: `/v1/community/relationships/followers/${encodeURIComponent(followerUserId)}${relationshipId ? `?${new URLSearchParams({ relationshipId })}` : ""}`,
    schema: removeFollowerResponseSchema,
  });
}

export async function fetchFollowers(
  client: ApiClient,
  page?: { limit?: number; cursor?: string },
): Promise<Result<RelationshipListResponse, ApiError>> {
  return client.request<RelationshipListResponse>({
    method: "GET",
    path: `/v1/community/relationships/followers${communityPageQuery(page)}`,
    schema: relationshipListResponseSchema,
  });
}

export async function fetchFollowing(
  client: ApiClient,
  page?: { limit?: number; cursor?: string },
): Promise<Result<RelationshipListResponse, ApiError>> {
  return client.request<RelationshipListResponse>({
    method: "GET",
    path: `/v1/community/relationships/following${communityPageQuery(page)}`,
    schema: relationshipListResponseSchema,
  });
}

export async function fetchIncomingFollowRequests(
  client: ApiClient,
  page?: { limit?: number; cursor?: string },
): Promise<Result<RelationshipListResponse, ApiError>> {
  return client.request<RelationshipListResponse>({
    method: "GET",
    path: `/v1/community/relationships/incoming${communityPageQuery(page)}`,
    schema: relationshipListResponseSchema,
  });
}

export async function fetchOutgoingFollowRequests(
  client: ApiClient,
  page?: { limit?: number; cursor?: string },
): Promise<Result<RelationshipListResponse, ApiError>> {
  return client.request<RelationshipListResponse>({
    method: "GET",
    path: `/v1/community/relationships/outgoing${communityPageQuery(page)}`,
    schema: relationshipListResponseSchema,
  });
}

export async function blockUser(
  client: ApiClient,
  blockedUserId: string,
): Promise<Result<CommunityBlockDto, ApiError>> {
  return client.request<CommunityBlockDto>({
    method: "POST",
    path: "/v1/community/blocks",
    body: { blockedUserId },
    schema: communityBlockDtoSchema,
  });
}

export async function unblockUser(
  client: ApiClient,
  blockedUserId: string,
): Promise<Result<UnblockCommunityResponse, ApiError>> {
  return client.request<UnblockCommunityResponse>({
    method: "DELETE",
    path: `/v1/community/blocks/${encodeURIComponent(blockedUserId)}`,
    schema: unblockCommunityResponseSchema,
  });
}

export async function fetchBlockedUsers(
  client: ApiClient,
  page?: { limit?: number; cursor?: string },
): Promise<Result<BlockedUserListResponse, ApiError>> {
  return client.request<BlockedUserListResponse>({
    method: "GET",
    path: `/v1/community/blocks${communityPageQuery(page)}`,
    schema: blockedUserListResponseSchema,
  });
}

function communityPageQuery(page?: {
  limit?: number;
  cursor?: string;
}): string {
  if (!page) return "";
  const query = new URLSearchParams();
  if (page.limit !== undefined) query.set("limit", String(page.limit));
  if (page.cursor) query.set("cursor", page.cursor);
  return query.size ? `?${query}` : "";
}

export async function fetchMutedUsers(
  client: ApiClient,
  page?: { limit?: number; cursor?: string },
): Promise<Result<MutedUserListResponse, ApiError>> {
  return client.request({
    method: "GET",
    path: `/v1/community/mutes${communityPageQuery(page)}`,
    schema: mutedUserListResponseSchema,
  });
}

export async function setUserMuted(
  client: ApiClient,
  targetUserId: string,
  muted: boolean,
): Promise<Result<{ muted: boolean }, ApiError>> {
  return client.request({
    method: "PUT",
    path: `/v1/community/mutes/${encodeURIComponent(targetUserId)}`,
    body: { muted },
    schema: setCommunityMuteSchema,
  });
}

// ==========================================
// Invitations (COMM-05)
// ==========================================

export async function createCommunityInvitation(
  client: ApiClient,
): Promise<Result<CreateInvitationResponse, ApiError>> {
  return client.request<CreateInvitationResponse>({
    method: "POST",
    path: "/v1/community/invitations",
    schema: createInvitationResponseSchema,
  });
}

export async function fetchCommunityInvitations(
  client: ApiClient,
): Promise<Result<CommunityInvitationListResponse, ApiError>> {
  return client.request<CommunityInvitationListResponse>({
    method: "GET",
    path: "/v1/community/invitations",
    schema: communityInvitationListResponseSchema,
  });
}

export async function resolveCommunityInvitation(
  client: ApiClient,
  token: string,
): Promise<Result<ResolveInvitationResponse, ApiError>> {
  return client.request<ResolveInvitationResponse>({
    method: "GET",
    path: `/v1/community/invitations/${encodeURIComponent(token)}`,
    schema: resolveInvitationResponseSchema,
  });
}

export async function revokeCommunityInvitation(
  client: ApiClient,
  invitationId: string,
): Promise<Result<RevokeInvitationResponse, ApiError>> {
  return client.request<RevokeInvitationResponse>({
    method: "DELETE",
    path: `/v1/community/invitations/${encodeURIComponent(invitationId)}`,
    schema: revokeInvitationResponseSchema,
  });
}

// ==========================================
// Workout Publication (COMM-06)
// ==========================================

export async function fetchWorkoutSharePreview(
  client: ApiClient,
  workoutId: string,
  timezone?: string,
): Promise<Result<WorkoutSharePreviewDto, ApiError>> {
  const query = timezone
    ? `?${new URLSearchParams({ timezone }).toString()}`
    : "";
  return client.request<WorkoutSharePreviewDto>({
    method: "GET",
    path: `/v1/community/workouts/${encodeURIComponent(workoutId)}/preview${query}`,
    schema: workoutSharePreviewDtoSchema,
  });
}

export async function publishWorkoutActivity(
  client: ApiClient,
  input: PublishWorkoutActivityInput,
): Promise<Result<AuthorSharedActivityDto, ApiError>> {
  return client.request<AuthorSharedActivityDto>({
    method: "POST",
    path: "/v1/community/activities",
    body: input,
    schema: authorSharedActivityDtoSchema,
  });
}

export async function fetchMealSharePreview(
  client: ApiClient,
  mealId: string,
  timezone?: string,
): Promise<Result<MealSharePreviewDto, ApiError>> {
  const query = timezone ? `?${new URLSearchParams({ timezone })}` : "";
  return client.request<MealSharePreviewDto>({
    method: "GET",
    path: `/v1/community/meals/${encodeURIComponent(mealId)}/preview${query}`,
    schema: mealSharePreviewDtoSchema,
  });
}

export async function publishMealActivity(
  client: ApiClient,
  input: PublishMealActivityInput,
): Promise<Result<AuthorSharedActivityDto, ApiError>> {
  return client.request<AuthorSharedActivityDto>({
    method: "POST",
    path: "/v1/community/meal-activities",
    body: input,
    schema: authorSharedActivityDtoSchema,
  });
}

/** ADR-0067: both exact server projections for a finished bouldering session. */
export async function fetchBoulderingSharePreview(
  client: ApiClient,
  sessionId: string,
): Promise<Result<BoulderingSharePreviewDto, ApiError>> {
  return client.request<BoulderingSharePreviewDto>({
    method: "GET",
    path: `/v1/community/bouldering-sessions/${encodeURIComponent(sessionId)}/preview`,
    schema: boulderingSharePreviewDtoSchema,
  });
}

export async function publishBoulderingActivity(
  client: ApiClient,
  input: PublishBoulderingActivityInput,
): Promise<Result<AuthorSharedActivityDto, ApiError>> {
  return client.request<AuthorSharedActivityDto>({
    method: "POST",
    path: "/v1/community/bouldering-activities",
    body: input,
    schema: authorSharedActivityDtoSchema,
  });
}

export async function updateSharedActivity(
  client: ApiClient,
  activityId: string,
  input: UpdateSharedActivityInput,
): Promise<Result<AuthorSharedActivityDto, ApiError>> {
  return client.request<AuthorSharedActivityDto>({
    method: "PATCH",
    path: `/v1/community/activities/${encodeURIComponent(activityId)}`,
    body: input,
    schema: authorSharedActivityDtoSchema,
  });
}

export async function unpublishActivity(
  client: ApiClient,
  activityId: string,
  expectedVersion?: number,
): Promise<Result<UnpublishActivityResponse, ApiError>> {
  return client.request<UnpublishActivityResponse>({
    method: "DELETE",
    path: `/v1/community/activities/${encodeURIComponent(activityId)}${expectedVersion ? `?version=${expectedVersion}` : ""}`,
    schema: unpublishActivityResponseSchema,
  });
}

export async function fetchSharedActivity(
  client: ApiClient,
  activityId: string,
): Promise<Result<SharedActivityFeedItemDto, ApiError>> {
  return client.request<SharedActivityFeedItemDto>({
    method: "GET",
    path: `/v1/community/activities/${encodeURIComponent(activityId)}`,
    schema: sharedActivityFeedItemDtoSchema,
  });
}

export async function fetchCommunityFeed(
  client: ApiClient,
  query?: { limit?: number; cursor?: string },
): Promise<Result<CommunityFeedResponse, ApiError>> {
  const params = new URLSearchParams();
  if (query?.limit) params.set("limit", String(query.limit));
  if (query?.cursor) params.set("cursor", query.cursor);
  const qs = params.toString();
  return client.request<CommunityFeedResponse>({
    method: "GET",
    path: `/v1/community/feed${qs ? `?${qs}` : ""}`,
    schema: tolerantCommunityFeedResponseSchema,
  });
}

// ==========================================
// Reactions (COMM-08)
// ==========================================

export async function setActivityReaction(
  client: ScopedCommunityClient,
  activityId: string,
  reaction: CommunityReactionKind | null,
): Promise<Result<ActivityReactionsResponse, CommunityClientError>> {
  return client.request<ActivityReactionsResponse>({
    method: "PUT",
    path: `/v1/community/activities/${encodeURIComponent(activityId)}/reaction`,
    body: { reaction },
    schema: activityReactionsResponseSchema,
  });
}

export async function getActivityReactions(
  client: ScopedCommunityClient,
  activityId: string,
): Promise<Result<ActivityReactionsResponse, CommunityClientError>> {
  return client.request<ActivityReactionsResponse>({
    method: "GET",
    path: `/v1/community/activities/${encodeURIComponent(activityId)}/reactions`,
    schema: activityReactionsResponseSchema,
  });
}

// ==========================================
// Safety & Reporting (COMM-09)
// ==========================================

export async function submitCommunityReport(
  client: ApiClient,
  input: CreateCommunityReportInput,
): Promise<Result<CommunityReportResponse, ApiError>> {
  return client.request<CommunityReportResponse>({
    method: "POST",
    path: "/v1/community/reports",
    body: input,
    schema: communityReportResponseSchema,
  });
}

export async function fetchMyCommunityReports(
  client: ApiClient,
  page?: { limit?: number; cursor?: string },
): Promise<Result<CommunityReportListResponse, ApiError>> {
  return client.request<CommunityReportListResponse>({
    method: "GET",
    path: `/v1/community/reports${communityPageQuery(page)}`,
    schema: communityReportListResponseSchema,
  });
}

export async function fetchSafetyContact(
  client: ApiClient,
): Promise<Result<SafetyContactInfo, ApiError>> {
  return client.request<SafetyContactInfo>({
    method: "GET",
    path: "/v1/community/safety/contact",
    schema: safetyContactInfoSchema,
  });
}

export async function submitModerationAppeal(
  client: ApiClient,
  input: CreateModerationAppealInput,
): Promise<Result<ModerationAppealDto, ApiError>> {
  return client.request<ModerationAppealDto>({
    method: "POST",
    path: "/v1/community/appeals",
    body: input,
    schema: moderationAppealDtoSchema,
  });
}

// ==========================================
// Error Humanization
// ==========================================

/** Cache retirement carries transport failures without changing their authority meaning. */
export function communityErrorCause(error: ApiError): ApiError {
  const visited = new Set<ApiError>();
  while (
    error.kind === "context_changed" &&
    error.cause &&
    !visited.has(error)
  ) {
    visited.add(error);
    error = error.cause;
  }
  return error;
}

/** Connectivity, rate-limit or server failures that say nothing about access. */
export function isTransientCommunityError(error: ApiError): boolean {
  error = communityErrorCause(error);
  return (
    error.kind === "network_error" ||
    (error.kind === "http_error" &&
      (error.status >= 500 || error.status === 429))
  );
}

export function humanizeCommunityError(
  error: ApiError,
  fallback = "An unexpected error occurred.",
): string {
  error = communityErrorCause(error);
  switch (error.kind) {
    case "context_changed":
      return "Community information changed. Try again.";
    case "not_configured":
      return "Community features are currently unavailable.";
    case "no_session":
    case "session_expired":
      return "Please sign in to access community features.";
    case "http_error": {
      if (error.code === "COMMUNITY_AGE_RESTRICTED") {
        return "We cannot confirm Community eligibility from your birth year. Your private tracking stays available.";
      }
      if (
        error.code === "COMMUNITY_SUSPENDED" ||
        error.code === "COMMUNITY_UNAVAILABLE"
      ) {
        return "Community is unavailable. Your private tracking and account controls stay available.";
      }
      if (error.code === "COMMUNITY_NOT_ENROLLED") {
        return "You must join Mizyun Friends to view community features.";
      }
      if (error.code === "HANDLE_TAKEN") {
        return "This handle is already taken or unavailable.";
      }
      if (error.code === "COMMUNITY_BLOCKED") {
        return "User unavailable.";
      }
      if (error.code === "FORBIDDEN") {
        return "You are not authorized to perform this action.";
      }
      if (error.code === "NOT_FOUND") {
        return "User or request not found.";
      }
      if (error.code === "DAILY_REPORT_LIMIT_EXCEEDED") {
        return "You have reached the daily reporting limit (10 per day). See Community safety for the verified contact. For immediate danger, contact local emergency services.";
      }
      if (error.code === "CONTENT_SAFETY_VIOLATION") {
        return "This text violates our community safety standards. Please revise before submitting.";
      }
      if (error.code === "INTERACTION_EXPIRED") {
        return "This interaction is older than 30 days and can no longer be reported.";
      }
      if (error.status === 429) {
        return "Too many requests. Please try again later.";
      }
      return error.message || fallback;
    }
    case "network_error":
      return "Unable to connect. Please check your internet connection.";
    default:
      return fallback;
  }
}
