import type { ApiClient } from "@mizyun/api-client";
import {
  communityGroupResultSchema,
  type CommunityGroupRequest,
  type CommunityGroupResult,
} from "@mizyun/contracts";
export function groupAction(client: ApiClient, body: CommunityGroupRequest) {
  return client.request<CommunityGroupResult>({
    method: "POST",
    path: "/v1/community/groups/operations",
    body,
    schema: communityGroupResultSchema,
  });
}
