import type { RepositorySupabaseClient } from "./index.js";
export class SupabaseCommunityFeatureStatus {
  constructor(
    private readonly clientFor: (token: string) => RepositorySupabaseClient,
  ) {}
  async read(token: string) {
    const { data, error } = await this.clientFor(token).rpc<{
      feature: string;
      enabled: boolean;
    }>("community_feature_status", {});
    if (error) throw new Error("Community controls unavailable");
    return data ?? [];
  }
}
