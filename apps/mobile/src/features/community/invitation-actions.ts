import { randomUUID } from "expo-crypto";
import type { ApiClient, ApiError } from "@mizyun/api-client";
import type {
  CreateInvitationResponse,
  FollowRelationshipDto,
} from "@mizyun/contracts";
import type { Result } from "@mizyun/core";
import {
  createCommunityInvitation,
  requestFollow,
  resolveCommunityInvitation,
} from "./community-client";

export async function prepareInvitationShare(
  client: ApiClient,
  existing: CreateInvitationResponse | null,
  now = Date.now(),
): Promise<Result<CreateInvitationResponse, ApiError>> {
  if (
    existing &&
    !existing.invitation.revokedAt &&
    new Date(existing.invitation.expiresAt).getTime() > now
  ) {
    return { ok: true, value: existing };
  }
  return createCommunityInvitation(client);
}

export async function followResolvedInvitation(
  client: ApiClient,
  token: string,
  expectedInviterUserId: string,
  isCurrent: () => boolean = () => true,
  operationId: string = randomUUID(),
): Promise<Result<FollowRelationshipDto, ApiError>> {
  if (!isCurrent()) return { ok: false, error: { kind: "no_session" } };
  const resolved = await resolveCommunityInvitation(client, token);
  if (!isCurrent()) return { ok: false, error: { kind: "no_session" } };
  if (!resolved.ok) return resolved;
  if (
    resolved.value.inviter.userId !== expectedInviterUserId ||
    resolved.value.isExpired ||
    resolved.value.isRevoked
  ) {
    return {
      ok: false,
      error: {
        kind: "http_error",
        status: 404,
        code: "NOT_FOUND",
        message:
          "Invitation is unavailable. Open a fresh invitation before following.",
      },
    };
  }
  return requestFollow(client, expectedInviterUserId, token, operationId);
}
