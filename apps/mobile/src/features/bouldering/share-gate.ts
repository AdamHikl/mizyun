import type { Href } from "expo-router";

/**
 * ADR-0067: "Share session" appears only for a finished, fully synced session
 * when bouldering is enabled and the user has an active Community profile.
 * The server re-checks every condition; this only hides an action that
 * would fail.
 */
export function canShareBoulderingSession(input: {
  readonly boulderingEnabled: boolean;
  readonly communityEnrolled: boolean;
  readonly completedAt: string | null | undefined;
  readonly pendingChanges?: number;
}): boolean {
  return (
    input.boulderingEnabled &&
    input.communityEnrolled &&
    typeof input.completedAt === "string" &&
    (input.pendingChanges ?? 0) === 0
  );
}

export function shareBoulderingHref(sessionId: string): Href {
  return {
    pathname: "/community/share-bouldering",
    params: { sessionId },
  } as Href;
}
