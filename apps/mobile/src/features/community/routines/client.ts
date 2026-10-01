import type { ApiClient } from "@mizyun/api-client";
import {
  communityRoutineListSchema,
  communityRoutinePreviewSchema,
  communityRoutineShareSchema,
  communityRoutineImportResultSchema,
  type CommunityRoutinePreview,
  type CommunityRoutineList,
  type CommunityRoutineShare,
  type CommunityRoutineImportResult,
} from "@mizyun/contracts";
export const listRoutineShares = (
  client: ApiClient,
  mine = false,
  cursor?: string,
) =>
  client.request<CommunityRoutineList>({
    method: "GET",
    path: `/v1/community/routines?mine=${mine}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    schema: communityRoutineListSchema,
  });
export const previewRoutineShare = (
  client: ApiClient,
  sourceWorkoutId: string,
  title: string,
) =>
  client.request<CommunityRoutinePreview>({
    method: "POST",
    path: "/v1/community/routines/preview",
    body: { sourceWorkoutId, title },
    schema: communityRoutinePreviewSchema,
  });
export const publishRoutineShare = (
  client: ApiClient,
  sourceWorkoutId: string,
  preview: CommunityRoutinePreview,
  operationId: string,
) =>
  client.request<CommunityRoutineShare>({
    method: "POST",
    path: "/v1/community/routines",
    body: { sourceWorkoutId, ...preview, operationId, confirmed: true },
    schema: communityRoutineShareSchema,
  });
export const importRoutineShare = (
  client: ApiClient,
  id: string,
  version: number,
) =>
  client.request<CommunityRoutineImportResult>({
    method: "POST",
    path: `/v1/community/routines/${encodeURIComponent(id)}/import`,
    body: { version, confirmed: true },
    schema: communityRoutineImportResultSchema,
  });
export const unshareRoutine = (client: ApiClient, id: string) =>
  client.request({
    method: "DELETE",
    path: `/v1/community/routines/${encodeURIComponent(id)}`,
  });
