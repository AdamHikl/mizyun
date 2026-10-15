import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";

import { MESSAGES, WeeklyReviewController } from "./weekly-review-controller";
import { proposalFixture, reviewFixture } from "./fixtures.test-util";

type Reply = { ok: boolean; value?: unknown; error?: unknown };

const setup = (
  replies: { get: Reply[]; post: Reply[] },
  options: { isCurrent?: () => boolean } = {},
) => {
  const gets = [...replies.get];
  const posts = [...replies.post];
  const resolvers: Array<() => void> = [];
  const request = vi.fn(async (req: { method: string; path?: string }) => {
    if (req.path?.startsWith("/v1/energy/summary")) {
      return { ok: true, value: { summary: { dailyTargetKcal: 2300 } } };
    }
    if (req.method === "POST") {
      await new Promise<void>((resolve) => resolvers.push(resolve));
      return posts.shift();
    }
    return gets.shift();
  });
  const onDecided = vi.fn();
  const controller = new WeeklyReviewController({
    client: { request } as unknown as ApiClient,
    userId: "u1",
    utcOffsetMinutes: () => 60,
    isCurrent: options.isCurrent ?? (() => true),
    onDecided,
  });
  return {
    controller,
    request,
    onDecided,
    release: () => resolvers.shift()?.(),
  };
};

const pendingBody = {
  ok: true,
  value: { review: reviewFixture(), proposal: proposalFixture() },
};

describe("WeeklyReviewController", () => {
  it("loads, then ignores a second decision while one is in flight", async () => {
    const accepted = proposalFixture({ status: "accepted" });
    const { controller, request, onDecided, release } = setup({
      get: [pendingBody],
      post: [{ ok: true, value: { proposal: accepted } }],
    });
    await controller.load();
    expect(controller.state.phase).toBe("ready");

    const first = controller.decide("accept");
    const second = controller.decide("accept");
    const third = controller.decide("decline");
    expect(controller.state.submitting).toBe("accept");
    release();
    await Promise.all([first, second, third]);

    const posts = request.mock.calls.filter(([r]) => r.method === "POST");
    expect(posts).toHaveLength(1);
    expect(controller.state.outcome).toBe("accept");
    expect(controller.state.submitting).toBeNull();
    expect(controller.state.snapshot?.proposal?.status).toBe("accepted");
    expect(onDecided).toHaveBeenCalledWith("accept");
  });

  it("refetches and explains on 409", async () => {
    const declinedElsewhere = proposalFixture({ status: "declined" });
    const { controller, release } = setup({
      get: [
        pendingBody,
        {
          ok: true,
          value: { review: reviewFixture(), proposal: declinedElsewhere },
        },
      ],
      post: [
        {
          ok: false,
          error: { kind: "http_error", status: 409, code: "c", message: "m" },
        },
      ],
    });
    await controller.load();
    const pending = controller.decide("accept");
    release();
    await pending;
    expect(controller.state.message).toBe(MESSAGES.stale);
    expect(controller.state.snapshot?.proposal?.status).toBe("declined");
    expect(controller.state.outcome).toBeNull();
    expect(controller.state.submitting).toBeNull();
  });

  it("says the choice may not be saved and refetches after a lost response", async () => {
    const landed = proposalFixture({ status: "accepted" });
    const { controller, release, request } = setup({
      get: [
        pendingBody,
        { ok: true, value: { review: reviewFixture(), proposal: landed } },
      ],
      post: [{ ok: false, error: { kind: "network_error", cause: 1 } }],
    });
    await controller.load();
    // An unparseable summary falls back to the review's own numbers.
    expect(controller.state.liveTargetKcal).toBeNull();
    const pending = controller.decide("accept");
    release();
    await pending;
    // The server had applied it: the real state wins over the error.
    expect(controller.state.snapshot?.proposal?.status).toBe("accepted");
    expect(controller.state.outcome).toBe("accept");
    expect(controller.state.submitting).toBeNull();
    const gets = request.mock.calls.filter(
      ([r]) => r.method === "GET" && r.path?.includes("weekly-review"),
    );
    expect(gets).toHaveLength(2);
  });

  it("keeps the uncertainty message and allows retry when still pending", async () => {
    const { controller, release } = setup({
      get: [pendingBody, pendingBody],
      post: [
        { ok: false, error: { kind: "network_error", cause: 1 } },
        {
          ok: true,
          value: { proposal: proposalFixture({ status: "declined" }) },
        },
      ],
    });
    await controller.load();
    const first = controller.decide("decline");
    release();
    await first;
    expect(controller.state.message).toBe(MESSAGES.uncertain);
    expect(MESSAGES.uncertain).toContain("may not have been saved");
    expect(controller.state.outcome).toBeNull();
    const second = controller.decide("decline");
    release();
    await second;
    expect(controller.state.outcome).toBe("decline");
    expect(controller.state.message).toBeNull();
  });

  it("does nothing without a pending proposal", async () => {
    const { controller, request } = setup({
      get: [
        {
          ok: true,
          value: {
            review: reviewFixture({ status: "hold", reasons: ["within_band"] }),
            proposal: null,
          },
        },
      ],
      post: [],
    });
    await controller.load();
    await controller.decide("accept");
    expect(
      request.mock.calls.filter(([r]) => r.method === "POST"),
    ).toHaveLength(0);
  });

  it("reports load failure and drops results from a retired owner", async () => {
    const failed = setup({
      get: [{ ok: false, error: { kind: "network_error", cause: 1 } }],
      post: [],
    });
    await failed.controller.load();
    expect(failed.controller.state.phase).toBe("error");
    expect(failed.controller.state.message).toBe(MESSAGES.loadFailed);

    let current = true;
    const retired = setup(
      { get: [pendingBody], post: [] },
      { isCurrent: () => current },
    );
    current = false;
    await retired.controller.load();
    expect(retired.controller.state.snapshot).toBeNull();
  });
});
