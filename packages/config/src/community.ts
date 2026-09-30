export interface CommunityOperationsConfig {
  readonly browsing: boolean;
  readonly enrollment: boolean;
  readonly discovery: boolean;
  readonly publish: boolean;
  readonly engagement: boolean;
  readonly delivery: boolean;
}
/** Admission requires an explicit environment decision at every growth boundary. */
export function loadCommunityOperations(
  env: Readonly<Record<string, string | undefined>>,
): CommunityOperationsConfig {
  const read = (name: string, fallback: boolean) =>
    env[name] === undefined ? fallback : env[name] === "true";
  const enabled = read("COMMUNITY_ENABLED", false);
  return {
    browsing: enabled,
    enrollment: enabled && read("COMMUNITY_ENROLLMENT_ENABLED", false),
    discovery: enabled && read("COMMUNITY_DISCOVERY_ENABLED", false),
    publish: enabled && read("COMMUNITY_PUBLISH_ENABLED", false),
    engagement: enabled && read("COMMUNITY_ENGAGEMENT_ENABLED", false),
    delivery: enabled && read("COMMUNITY_DELIVERY_ENABLED", false),
  };
}
