import type { ApiClient } from "@mizyun/api-client";
import {
  communityCommentPageSchema,
  communityCommentCandidatesSchema,
  communityCommentPreferencesSchema,
  communityCommentMentionInboxSchema,
  communityCommentAckSchema,
  communityCommentReportAckSchema,
  communityCommentSettingsSchema,
  type CommunityCommentPage,
  type CommunityCommentCandidates,
  type CommunityCommentMentionInbox,
} from "@mizyun/contracts";

export const fetchCommentPage = (
  client: ApiClient,
  activityId: string,
  cursor?: string,
) =>
  client.request<CommunityCommentPage>({
    method: "GET",
    path: `/v1/community/activities/${encodeURIComponent(activityId)}/comments?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    schema: communityCommentPageSchema,
  });
export const fetchCommentCandidates = (client: ApiClient, activityId: string) =>
  client.request<CommunityCommentCandidates>({
    method: "GET",
    path: `/v1/community/activities/${encodeURIComponent(activityId)}/comments/candidates`,
    schema: communityCommentCandidatesSchema,
  });
export const fetchCommentPreferences = (client: ApiClient) =>
  client.request<{ allowMentions: boolean }>({
    method: "GET",
    path: "/v1/community/comments/preferences",
    schema: communityCommentPreferencesSchema,
  });
export const fetchCommentMentions = (client: ApiClient) =>
  client.request<CommunityCommentMentionInbox>({
    method: "GET",
    path: "/v1/community/comments/mentions",
    schema: communityCommentMentionInboxSchema,
  });
export const saveComment = (
  client: ApiClient,
  activityId: string,
  body: {
    id: string;
    operationId: string;
    parentId: string | null;
    body: string;
    expectedVersion: number;
    mentions: readonly string[];
  },
) =>
  client.request<{ id: string; version: number }>({
    method: "POST",
    path: `/v1/community/activities/${encodeURIComponent(activityId)}/comments`,
    body,
    schema: communityCommentAckSchema,
  });
export const removeComment = (
  client: ApiClient,
  id: string,
  expectedVersion: number,
) =>
  client.request<{ id: string; version: number }>({
    method: "DELETE",
    path: `/v1/community/comments/${encodeURIComponent(id)}`,
    body: { expectedVersion },
    schema: communityCommentAckSchema,
  });
export const saveCommentSettings = (
  client: ApiClient,
  activityId: string,
  enabled: boolean,
) =>
  client.request<{ enabled: boolean }>({
    method: "PUT",
    path: `/v1/community/activities/${encodeURIComponent(activityId)}/comments/settings`,
    body: { enabled },
    schema: communityCommentSettingsSchema,
  });
export const saveCommentPreferences = (
  client: ApiClient,
  allowMentions: boolean,
) =>
  client.request<{ allowMentions: boolean }>({
    method: "PUT",
    path: "/v1/community/comments/preferences",
    body: { allowMentions },
    schema: communityCommentPreferencesSchema,
  });
export const reportComment = (client: ApiClient, id: string, reason: string) =>
  client.request<{ id: string }>({
    method: "POST",
    path: `/v1/community/comments/${encodeURIComponent(id)}/report`,
    body: { reason },
    schema: communityCommentReportAckSchema,
  });
