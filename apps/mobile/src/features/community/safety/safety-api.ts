import {
  communitySafetyReceiptResponseSchema,
  communitySafetyReceiptListSchema,
  communitySafetyNoticeListSchema,
  safetyContactInfoSchema,
  type SafetyContactInfo,
} from "@mizyun/contracts";
import type { ApiClient } from "@mizyun/api-client";

export type VerifiedSafetyContact = SafetyContactInfo;
export interface RecentReceipt {
  readonly id: string;
  readonly targetType: "profile" | "activity";
  readonly targetId: string;
  readonly expiresAt: string;
}
export interface OwnNotice {
  readonly id: string;
  readonly targetType: "profile" | "activity";
  readonly targetId: string;
  readonly reason: string;
  readonly status: string;
  readonly createdAt: string;
  readonly decision: "warn" | "remove" | "suspend" | "ban" | "dismiss" | null;
  readonly actionTakenAt: string | null;
  readonly suspensionExpiresAt: string | null;
}
export const recentReceiptListSchema = communitySafetyReceiptListSchema;
export const ownNoticeListSchema = communitySafetyNoticeListSchema;
export const requestSafetyContact = (client: ApiClient) =>
  client.request<VerifiedSafetyContact>({
    method: "GET",
    path: "/v1/community/safety/contact",
    schema: safetyContactInfoSchema,
  });
export const captureSafetyReceipt = (
  client: ApiClient,
  targetType: "profile" | "activity",
  targetId: string,
) =>
  client.request<{ id: string }>({
    method: "POST",
    path: "/v1/community/safety/receipts",
    body: { targetType, targetId },
    schema: communitySafetyReceiptResponseSchema,
  });
