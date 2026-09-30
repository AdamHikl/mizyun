import {
  CommunityMutationError,
  type CommunityNotificationRepository,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";
export class SupabaseCommunityNotificationRepository implements CommunityNotificationRepository {
  constructor(
    private readonly clientFor: (token: string) => RepositorySupabaseClient,
  ) {}
  async execute(
    operation: Parameters<CommunityNotificationRepository["execute"]>[0],
    args: Readonly<Record<string, unknown>>,
    accessToken: string,
  ): Promise<unknown> {
    const { data, error } = await this.clientFor(accessToken).rpc(
      "community_notifications",
      { p_operation: operation, p_args: args },
    );
    if (error) {
      const reasons = {
        community_access_denied: "access_denied",
        community_unavailable: "unavailable",
        community_invalid_action: "invalid_input",
        community_rate_limited: "rate_limited",
      } as const;
      const reason = reasons[error.message as keyof typeof reasons];
      if (error.code === "P0001" && reason)
        throw new CommunityMutationError(reason);
      throw new RepositoryError("Community notification operation unavailable");
    }
    return data;
  }
}
