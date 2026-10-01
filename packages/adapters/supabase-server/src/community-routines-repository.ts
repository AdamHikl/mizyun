import {
  CommunityMutationError,
  type CommunityRoutineRepository,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";
export class SupabaseCommunityRoutineRepository implements CommunityRoutineRepository {
  constructor(
    private readonly clientFor: (token: string) => RepositorySupabaseClient,
  ) {}
  async execute(
    operation: Parameters<CommunityRoutineRepository["execute"]>[0],
    args: Readonly<Record<string, unknown>>,
    accessToken: string,
  ): Promise<unknown> {
    const { data, error } = await this.clientFor(accessToken).rpc(
      "community_routines",
      { p_operation: operation, p_args: args },
    );
    if (error) {
      const reasons = {
        community_access_denied: "access_denied",
        community_unavailable: "unavailable",
        community_conflict: "conflict",
        community_invalid_input: "invalid_input",
        community_content_violation: "content_violation",
        community_rate_limited: "rate_limited",
      } as const;
      const reason = reasons[error.message as keyof typeof reasons];
      if (error.code === "P0001" && reason)
        throw new CommunityMutationError(reason);
      throw new RepositoryError("Community routine operation unavailable");
    }
    return data;
  }
}
