import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import {
  publishBoulderingActivitySchema,
  type BoulderingSharePreviewDto,
} from "@mizyun/contracts";
import {
  humanizeBoulderingShareError,
  retiresBoulderingPreview,
  saveBoulderingShare,
} from "./share-bouldering-actions";

const plain = {
  activityDate: "2026-10-16",
  topGrade: "6C" as const,
  sends: 9,
  flashes: 4,
  gradeBreakdown: null,
};
const preview: BoulderingSharePreviewDto = {
  sessionId: "10000000-0000-4000-8000-000000000001",
  enrollmentGeneration: 3,
  existingActivity: null,
  sharedDay: "2026-10-16",
  boulderingDetails: plain,
  boulderingDetailsWithBreakdown: {
    ...plain,
    gradeBreakdown: [
      { grade: "6C", sends: 2 },
      { grade: "6B", sends: 7 },
    ],
  },
  followerCount: 2,
};
const intent = {
  sessionId: preview.sessionId,
  preview,
  includeGradeBreakdown: false,
  operationId: "00000000-0000-4000-8000-000000000001",
  enrollmentGeneration: 3,
};

function client() {
  const request = vi.fn().mockResolvedValue({ ok: true, value: {} });
  return { request, api: { request } as unknown as ApiClient };
}

describe("deliberate bouldering publication", () => {
  it("sends exactly the chosen server projection in a contract-valid body", async () => {
    for (const includeGradeBreakdown of [false, true]) {
      const { request, api } = client();
      await saveBoulderingShare(api, { ...intent, includeGradeBreakdown });
      const call = request.mock.calls[0]![0];
      expect(call.method).toBe("POST");
      expect(call.path).toBe("/v1/community/bouldering-activities");
      expect(publishBoulderingActivitySchema.parse(call.body)).toEqual(
        call.body,
      );
      expect(call.body).toEqual({
        sessionId: preview.sessionId,
        sharedDay: "2026-10-16",
        includeGradeBreakdown,
        expectedBoulderingDetails: includeGradeBreakdown
          ? preview.boulderingDetailsWithBreakdown
          : preview.boulderingDetails,
        operationId: intent.operationId,
        enrollmentGeneration: 3,
        expectedVersion: 0,
        expectedRevoked: false,
      });
    }
  });
  it("fences updates of an existing or revoked card by version", async () => {
    const { request, api } = client();
    await saveBoulderingShare(api, {
      ...intent,
      existingActivityId: "card-a",
      preview: {
        ...preview,
        existingActivity: {
          id: "card-a",
          version: 4,
          revokedAt: "2026-10-16T10:00:00.000Z",
        } as any,
      },
    });
    expect(request.mock.calls[0]![0].body).toMatchObject({
      expectedVersion: 4,
      expectedRevoked: true,
    });
  });
  it("rejects a stale preview locally without a request", async () => {
    const cases = [
      { ...intent, sessionId: "10000000-0000-4000-8000-000000000002" },
      { ...intent, enrollmentGeneration: 4 },
      { ...intent, existingActivityId: "card-b" },
      // A breakdown flag with no breakdown would be refused by the server.
      {
        ...intent,
        includeGradeBreakdown: true,
        preview: {
          ...preview,
          boulderingDetailsWithBreakdown: preview.boulderingDetails,
        },
      },
    ];
    for (const input of cases) {
      const { request, api } = client();
      const result = await saveBoulderingShare(api, input);
      expect(result.ok).toBe(false);
      expect(request).not.toHaveBeenCalled();
    }
  });
  it("retires the preview for denied, stale, unfinished and disabled responses", () => {
    for (const status of [401, 403, 404, 409, 422, 503])
      expect(
        retiresBoulderingPreview({
          kind: "http_error",
          status,
          code: "X",
          message: "",
        } as any),
      ).toBe(true);
    expect(retiresBoulderingPreview({ kind: "network_error" } as any)).toBe(
      false,
    );
  });
  it("explains bouldering-specific failures", () => {
    const http = (status: number, code: string) =>
      ({ kind: "http_error", status, code, message: "server" }) as any;
    expect(
      humanizeBoulderingShareError(http(503, "FEATURE_DISABLED"), "x"),
    ).toContain("isn't available");
    expect(
      humanizeBoulderingShareError(http(422, "WORKOUT_NOT_COMPLETED"), "x"),
    ).toBe("Finish the session before sharing it.");
    expect(humanizeBoulderingShareError(http(409, "CONFLICT"), "x")).toContain(
      "Reload the preview",
    );
    expect(
      humanizeBoulderingShareError({ kind: "network_error" } as any, "x"),
    ).toContain("internet connection");
  });

  it("unwraps a retired read before choosing the share copy", () => {
    const wrapped = {
      kind: "context_changed",
      cause: {
        kind: "http_error",
        status: 404,
        code: "COMMUNITY_NOT_ENROLLED",
        message: "server",
      },
    } as any;
    expect(humanizeBoulderingShareError(wrapped, "x")).toBe(
      "Join Community to share sessions with your approved followers.",
    );
  });
});
