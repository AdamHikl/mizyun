import type { ApiClient } from "@mizyun/api-client";
import {
  communityInboxResponseSchema,
  communityNotificationEventSchema,
  communityNotificationPreferencesSchema,
  communityNotificationDestinationSchema,
  type CommunityNotificationEvent,
  type CommunityInboxResponse,
  type CommunityNotificationPreferences,
} from "@mizyun/contracts";

export type {
  CommunityNotificationEvent,
  CommunityInboxResponse,
  CommunityNotificationPreferences,
} from "@mizyun/contracts";
export interface CommunityNotificationDestination {
  destination: "relationships" | "activity" | "safety";
  targetId: string | null;
}
export const fetchCommunityInbox = (client: ApiClient, cursor?: string) => {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  return client.request<CommunityInboxResponse>({
    method: "GET",
    path: `/v1/community/notifications/inbox?${query}`,
    schema: communityInboxResponseSchema,
  });
};
export const readCommunityNotification = (client: ApiClient, id: string) =>
  client.request<{ id: string; readAt: string }>({
    method: "POST",
    path: `/v1/community/notifications/inbox/${encodeURIComponent(id)}/read`,
    schema: communityNotificationEventSchema.pick({ id: true, readAt: true }),
  });
export const resolveCommunityNotification = (client: ApiClient, id: string) =>
  client.request<CommunityNotificationDestination>({
    method: "GET",
    path: `/v1/community/notifications/inbox/${encodeURIComponent(id)}`,
    schema: communityNotificationDestinationSchema,
  });
export const fetchCommunityNotificationPreferences = (client: ApiClient) =>
  client.request<CommunityNotificationPreferences>({
    method: "GET",
    path: "/v1/community/notifications/preferences",
    schema: communityNotificationPreferencesSchema,
  });
export const saveCommunityNotificationPreferences = (
  client: ApiClient,
  preferences: CommunityNotificationPreferences,
) =>
  client.request<CommunityNotificationPreferences>({
    method: "PUT",
    path: "/v1/community/notifications/preferences",
    body: preferences,
    schema: communityNotificationPreferencesSchema,
  });
