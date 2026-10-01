import {
  CommunityMutationError,
  type CommunityBroaderDiscoveryRepository,
} from "@mizyun/core";
import type { RepositorySupabaseClient } from "./index.js";
interface Row extends Record<string, unknown> {
  result: Record<string, unknown>;
}
export class SupabaseCommunityBroaderDiscoveryRepository implements CommunityBroaderDiscoveryRepository {
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
    const { data, error } = await this.clientFor(accessToken).rpc<Row>(
      "community_broader_discovery_rpc",
      { p_operation: operation, p_args: args },
    );
    if (error)
      throw new CommunityMutationError(
        String((error as { message?: string }).message).includes("rate_limited")
          ? "rate_limited"
          : "unavailable",
      );
    if (!data?.[0]) throw new CommunityMutationError("unavailable");
    return data[0].result;
  }
}
