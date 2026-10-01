import type { ApiClient } from "@mizyun/api-client";
import {
  communityMediaItemSchema,
  communityMediaListSchema,
  communityMediaContentSchema,
  type CommunityMediaItem,
  type CommunityMediaList,
  type CommunityMediaContent,
} from "@mizyun/contracts";
export const fetchCommunityMedia = (
  client: ApiClient,
  mode: "feed" | "mine" | "review",
  cursor?: string,
) =>
  client.request<CommunityMediaList>({
    method: "GET",
    path: `/v1/community/media${mode === "review" ? "/moderation" : ""}?limit=10${mode === "mine" ? "&mine=true" : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    schema: communityMediaListSchema,
  });
export const fetchCommunityMediaContent = (
  client: ApiClient,
  id: string,
  variant: "image" | "thumbnail" = "thumbnail",
) =>
  client.request<CommunityMediaContent>({
    method: "POST",
    path: `/v1/community/media/${encodeURIComponent(id)}/content`,
    body: { variant },
    schema: communityMediaContentSchema,
  });
export const uploadCommunityMedia = (
  client: ApiClient,
  input: { operationId: string; altText: string; base64: string },
) =>
  client.request<CommunityMediaItem>({
    method: "POST",
    path: "/v1/community/media",
    body: { ...input, mimeType: "image/jpeg", rightsConfirmed: true },
    schema: communityMediaItemSchema,
  });
export const removeCommunityMedia = (client: ApiClient, id: string) =>
  client.request({
    method: "DELETE",
    path: `/v1/community/media/${encodeURIComponent(id)}`,
  });
export const reviewCommunityMedia = (
  client: ApiClient,
  id: string,
  decision: "approve" | "reject",
  reason: string,
) =>
  client.request<CommunityMediaItem>({
    method: "POST",
    path: `/v1/community/media/${encodeURIComponent(id)}/review`,
    body: { decision, reason },
    schema: communityMediaItemSchema,
  });
