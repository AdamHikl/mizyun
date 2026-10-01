import {
  CommunityMutationError,
  type CommunityGroupsRepository,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";
export class SupabaseCommunityGroupsRepository implements CommunityGroupsRepository {
  constructor(
    private readonly clientFor: (token: string) => RepositorySupabaseClient,
  ) {}
  async execute(
    operation: string,
    args: Readonly<Record<string, unknown>>,
    accessToken: string,
  ): Promise<unknown> {
    const { data, error } = await this.clientFor(accessToken).rpc(
      "community_groups_rpc",
      { p_operation: operation, p_args: args },
    );
    if (error) {
      const reasons = {
        community_unavailable: "unavailable",
        community_access_denied: "access_denied",
        community_conflict: "conflict",
        community_rate_limited: "rate_limited",
        community_invalid_action: "invalid_input",
      } as const;
      const reason = reasons[error.message as keyof typeof reasons];
      if (error.code === "P0001" && reason)
        throw new CommunityMutationError(reason);
      throw new RepositoryError("Community group operation unavailable");
    }
    return data;
  }
}
