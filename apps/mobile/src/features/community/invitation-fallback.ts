/** Review-ready website contract. Do not use for sharing before website acceptance. */
export const COMMUNITY_INVITATION_FALLBACK_URL =
  "https://www.phiskel.com/community/invite";

export type CommunityInvitationEnvironment = "dev" | "production";

export interface CommunityInvitationFallback {
  readonly environment: CommunityInvitationEnvironment;
  readonly token: string;
}

function isEnvironment(
  value: unknown,
): value is CommunityInvitationEnvironment {
  return value === "dev" || value === "production";
}

/** Tokens remain in the fragment, never the path or query sent to the website. */
export function buildCommunityInvitationFallbackLink(
  token: string,
  environment: CommunityInvitationEnvironment,
): string | null {
  if (
    !isEnvironment(environment) ||
    token.length !== 22 ||
    !/^[A-Za-z0-9_-]{22}$/.test(token)
  )
    return null;
  return `${COMMUNITY_INVITATION_FALLBACK_URL}#${environment}/${token}`;
}

/** Accept only the canonical fragment; do not decode or normalize capabilities. */
export function parseCommunityInvitationFallbackFragment(
  fragment: string,
): CommunityInvitationFallback | null {
  const match = /^#(dev|production)\/([A-Za-z0-9_-]{22})$/.exec(fragment);
  if (!match || match[0] !== fragment) return null;
  return {
    environment: match[1] as CommunityInvitationEnvironment,
    token: match[2]!,
  };
}

export function parseCommunityInvitationFallbackLink(
  rawUrl: string,
  expectedEnvironment: CommunityInvitationEnvironment,
): CommunityInvitationFallback | null {
  // Exact prefix avoids URL normalization accepting ports, credentials, dot
  // segments, encoded fragments, alternate origins, queries, or whitespace.
  if (
    !isEnvironment(expectedEnvironment) ||
    !rawUrl.startsWith(`${COMMUNITY_INVITATION_FALLBACK_URL}#`)
  )
    return null;
  const invitation = parseCommunityInvitationFallbackFragment(
    rawUrl.slice(COMMUNITY_INVITATION_FALLBACK_URL.length),
  );
  return invitation?.environment === expectedEnvironment ? invitation : null;
}
