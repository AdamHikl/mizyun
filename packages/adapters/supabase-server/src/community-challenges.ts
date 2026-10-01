import {
  CommunityMutationError,
  type CommunityChallengesRepository,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
interface Row extends Record<string, unknown> {
  result: Record<string, unknown>;
}
export class SupabaseCommunityChallengesRepository implements CommunityChallengesRepository {
  constructor(
    private readonly clientFor: (token: string) => RepositorySupabaseClient,
  ) {}
  async execute(
    operation: string,
    args: Record<string, unknown>,
    token: string,
  ) {
    const { data, error } = await this.clientFor(token).rpc<Row>(
      "community_challenges_rpc",
      { p_operation: operation, p_args: args },
    );
    if (error) {
      const msg = String((error as { message?: string }).message);
      throw new CommunityMutationError(
        msg.includes("conflict")
          ? "conflict"
          : msg.includes("invalid_input")
            ? "invalid_input"
            : msg.includes("rate_limited")
              ? "rate_limited"
              : "unavailable",
      );
    }
    if (!data?.[0]) throw new CommunityMutationError("unavailable");
    return data[0].result;
  }
}
