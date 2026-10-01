import {
  CommunityMutationError,
  type CommunityMessagingRepository,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
interface ResultRow extends Record<string, unknown> {
  result: Record<string, unknown>;
}
export class SupabaseCommunityMessagingRepository implements CommunityMessagingRepository {
  constructor(
    private readonly clientFor: (
      accessToken: string,
    ) => RepositorySupabaseClient,
  ) {}
  async execute(
    operation: string,
    args: Record<string, unknown>,
    accessToken: string,
  ) {
    const client = await this.clientFor(accessToken);
    const { data, error } = await client.rpc<ResultRow>(
      "community_messaging_rpc",
      { p_operation: operation, p_args: args },
    );
    if (error) {
      const message = String((error as { message?: string }).message ?? "");
      throw new CommunityMutationError(
        message.includes("rate_limited")
          ? "rate_limited"
          : message.includes("conflict")
            ? "conflict"
            : message.includes("invalid_input")
              ? "invalid_input"
              : "unavailable",
      );
    }
    if (!data?.[0]) throw new CommunityMutationError("unavailable");
    return data[0].result;
  }
}
