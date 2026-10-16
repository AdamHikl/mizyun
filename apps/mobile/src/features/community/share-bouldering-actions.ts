import type { ApiClient, ApiError } from "@mizyun/api-client";
import type {
  AuthorSharedActivityDto,
  BoulderingSharePreviewDto,
  SharedBoulderingDetails,
} from "@mizyun/contracts";
import type { Result } from "@mizyun/core";
import {
  humanizeCommunityError,
  publishBoulderingActivity,
} from "./community-client";

/**
 * The exact server projection for the chosen breakdown option (ADR-0067).
 * The client never computes a snapshot; it only picks one of the two the
 * preview returned.
 */
export function selectedBoulderingProjection(
  preview: BoulderingSharePreviewDto,
  includeGradeBreakdown: boolean,
): SharedBoulderingDetails {
  return includeGradeBreakdown
    ? preview.boulderingDetailsWithBreakdown
    : preview.boulderingDetails;
}

/** Only the allowlisted, deliberately previewed projection crosses this boundary. */
export async function saveBoulderingShare(
  client: ApiClient,
  input: {
    sessionId: string;
    preview: BoulderingSharePreviewDto;
    includeGradeBreakdown: boolean;
    operationId: string;
    enrollmentGeneration: number;
    existingActivityId?: string | null;
  },
): Promise<Result<AuthorSharedActivityDto, ApiError>> {
  const expected = selectedBoulderingProjection(
    input.preview,
    input.includeGradeBreakdown,
  );
  if (
    input.preview.sessionId !== input.sessionId ||
    input.enrollmentGeneration !== input.preview.enrollmentGeneration ||
    (input.existingActivityId &&
      input.existingActivityId !== input.preview.existingActivity?.id) ||
    // The server rejects a breakdown flag that disagrees with the snapshot.
    (expected.gradeBreakdown !== null) !== input.includeGradeBreakdown
  ) {
    return {
      ok: false,
      error: {
        kind: "http_error",
        status: 409,
        code: "STALE_PREVIEW",
        message: "Reload the session preview before sharing.",
      },
    };
  }
  return publishBoulderingActivity(client, {
    sessionId: input.sessionId,
    sharedDay: input.preview.sharedDay,
    includeGradeBreakdown: input.includeGradeBreakdown,
    expectedBoulderingDetails: expected,
    operationId: input.operationId,
    enrollmentGeneration: input.enrollmentGeneration,
    expectedVersion: input.preview.existingActivity?.version ?? 0,
    expectedRevoked: input.preview.existingActivity?.revokedAt != null,
  });
}

/** Errors that retire the preview: a fresh preview is required to continue. */
export function retiresBoulderingPreview(error: ApiError): boolean {
  return (
    error.kind === "no_session" ||
    error.kind === "session_expired" ||
    (error.kind === "http_error" &&
      [401, 403, 404, 409, 422, 503].includes(error.status))
  );
}

/** Session-specific copy for the bouldering share errors, else Community copy. */
export function humanizeBoulderingShareError(
  error: ApiError,
  fallback: string,
): string {
  if (error.kind === "http_error") {
    switch (error.code) {
      case "FEATURE_DISABLED":
        return "Bouldering sharing isn't available right now. Your session stays private.";
      case "WORKOUT_NOT_COMPLETED":
        return "Finish the session before sharing it.";
      case "NOT_FOUND":
        return "This session is no longer available. It may have been deleted.";
      case "CONFLICT":
      case "STALE_PREVIEW":
        return "The session or your shared card changed. Reload the preview to see what will be shared.";
      case "COMMUNITY_NOT_ENROLLED":
        return "Join Community to share sessions with your approved followers.";
      default:
        if (error.status === 409)
          return "The session or your shared card changed. Reload the preview to see what will be shared.";
    }
  }
  return humanizeCommunityError(error, fallback);
}
