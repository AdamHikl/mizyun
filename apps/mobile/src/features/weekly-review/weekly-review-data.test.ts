import { describe, expect, it, vi } from "vitest";
import type { ApiClient, ApiError } from "@mizyun/api-client";

import {
  decideWeeklyReview,
  fetchWeeklyReview,
  isPendingProposal,
} from "./weekly-review-data";
import { proposalFixture, reviewFixture } from "./fixtures.test-util";

const clientWith = (result: unknown) =>
  ({ request: vi.fn().mockResolvedValue(result) }) as unknown as ApiClient & {
    request: ReturnType<typeof vi.fn>;
  };

const httpError = (status: number): ApiError => ({
  kind: "http_error",
  status,
  code: "x",
  message: "x",
});

describe("fetchWeeklyReview", () => {
  it("requests the local offset and parses the response", async () => {
    const proposal = proposalFixture();
    const client = clientWith({
      ok: true,
      value: { review: reviewFixture(), proposal },
    });
    const result = await fetchWeeklyReview(client, 120, {
      expectedUserId: "u1",
    });
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/v1/energy/weekly-review?utcOffsetMinutes=120",
        expectedUserId: "u1",
      }),
    );
    expect(result).toMatchObject({
      kind: "ok",
      snapshot: { proposal: { id: proposal.id, status: "pending" } },
    });
  });

  it("accepts a null review and proposal (no active goal)", async () => {
    const client = clientWith({
      ok: true,
      value: { review: null, proposal: null },
    });
    expect(await fetchWeeklyReview(client, 0)).toEqual({
      kind: "ok",
      snapshot: { review: null, proposal: null },
    });
  });

  it("rejects a malformed body as a validation error", async () => {
    const client = clientWith({ ok: true, value: { review: { bad: 1 } } });
    const result = await fetchWeeklyReview(client, 0);
    expect(result).toMatchObject({
      kind: "error",
      error: { kind: "validation_error" },
    });
  });

  it("surfaces transport errors", async () => {
    const client = clientWith({
      ok: false,
      error: { kind: "network_error", cause: new Error("offline") },
    });
    expect(await fetchWeeklyReview(client, 0)).toMatchObject({
      kind: "error",
    });
  });
});

describe("decideWeeklyReview", () => {
  const decided = proposalFixture({ status: "accepted" });

  it("posts the decision and returns the decided proposal", async () => {
    const client = clientWith({ ok: true, value: { proposal: decided } });
    const result = await decideWeeklyReview(client, decided.id, "accept");
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: `/v1/energy/weekly-review/${decided.id}/decision`,
        body: { decision: "accept" },
      }),
    );
    expect(result).toMatchObject({
      kind: "decided",
      proposal: { status: "accepted" },
    });
  });

  it("maps 409 to stale so callers refetch", async () => {
    const client = clientWith({ ok: false, error: httpError(409) });
    expect(await decideWeeklyReview(client, decided.id, "decline")).toEqual({
      kind: "stale",
    });
  });

  it("maps network failures to offline and others to error", async () => {
    expect(
      await decideWeeklyReview(
        clientWith({
          ok: false,
          error: { kind: "network_error", cause: 1 },
        }),
        decided.id,
        "accept",
      ),
    ).toEqual({ kind: "offline" });
    expect(
      await decideWeeklyReview(
        clientWith({ ok: false, error: httpError(500) }),
        decided.id,
        "accept",
      ),
    ).toEqual({ kind: "error" });
  });

  it("treats an unparseable success body as an error", async () => {
    const client = clientWith({ ok: true, value: { proposal: { id: 1 } } });
    expect(await decideWeeklyReview(client, decided.id, "accept")).toEqual({
      kind: "error",
    });
  });
});

describe("isPendingProposal", () => {
  it("is true only for pending proposals", () => {
    expect(isPendingProposal(proposalFixture())).toBe(true);
    expect(isPendingProposal(proposalFixture({ status: "declined" }))).toBe(
      false,
    );
    expect(isPendingProposal(null)).toBe(false);
  });
});
