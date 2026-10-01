import {
  CommunityMutationError,
  type CommunityCommentsRepository,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";

export class SupabaseCommunityCommentsRepository implements CommunityCommentsRepository {
  constructor(
    private readonly clientFor: (
      accessToken: string,
    ) => RepositorySupabaseClient,
  ) {}
  async execute(
    operation: Parameters<CommunityCommentsRepository["execute"]>[0],
    args: Readonly<Record<string, unknown>>,
    accessToken: string,
  ): Promise<unknown> {
    const { data, error } = await this.clientFor(accessToken).rpc(
      "community_comments",
      { p_operation: operation, p_args: args },
    );
    if (error) {
      const codes = {
        community_unavailable: "unavailable",
        community_access_denied: "access_denied",
        community_conflict: "conflict",
        community_invalid_action: "invalid_input",
        community_invalid_profile: "content_violation",
        community_rate_limited: "rate_limited",
      } as const;
      const code = codes[error.message as keyof typeof codes];
      if (error.code === "P0001" && code)
        throw new CommunityMutationError(code);
      throw new RepositoryError("Community comment operation unavailable");
    }
    return data;
  }
}
