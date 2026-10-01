export interface CommunityBroaderDiscoveryRepository {
  execute(
    operation: string,
    args: Readonly<Record<string, unknown>>,
    accessToken: string,
  ): Promise<Record<string, unknown>>;
}
