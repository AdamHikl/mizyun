import { describe, expect, it, vi } from "vitest";
import type { UserId } from "@mizyun/core";
import { SupabaseProductAnalyticsRepository } from "./product-analytics-repository.js";

describe("SupabaseProductAnalyticsRepository", () => {
  const userId = "11111111-1111-4111-8111-111111111111" as UserId;
  const epoch = "22222222-2222-4222-8222-222222222222";

  it("gets consent from product_analytics_consents table", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        user_id: userId,
        version: "product-analytics-v2",
        granted: true,
        revision: 1,
        epoch,
        consented_at: "2026-09-13T08:00:00.000Z",
        revoked_at: null,
        created_at: "2026-09-13T08:00:00.000Z",
        updated_at: "2026-09-13T08:00:00.000Z",
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const mockClient = { from } as any;

    const repo = new SupabaseProductAnalyticsRepository({
      client: mockClient,
    });
    const consent = await repo.getConsent(userId);

    expect(from).toHaveBeenCalledWith("product_analytics_consents");
    expect(consent).toMatchObject({
      userId,
      version: "product-analytics-v2",
      granted: true,
      revision: 1,
      epoch,
    });
  });

  it("updates consent via update_product_analytics_consent RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        consent: {
          user_id: userId,
          version: "product-analytics-v2",
          granted: true,
          revision: 2,
          epoch,
          consented_at: "2026-09-13T08:00:00.000Z",
          revoked_at: null,
          created_at: "2026-09-13T08:00:00.000Z",
          updated_at: "2026-09-13T08:05:00.000Z",
        },
      },
      error: null,
    });
    const mockClient = { rpc } as any;
    const repo = new SupabaseProductAnalyticsRepository({
      client: mockClient,
    });

    const res = await repo.updateConsent(userId, {
      version: "product-analytics-v2",
      granted: true,
      expectedRevision: 1,
    });

    expect(rpc).toHaveBeenCalledWith("update_product_analytics_consent", {
      p_user_id: userId,
      p_version: "product-analytics-v2",
      p_granted: true,
      p_expected_revision: 1,
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.consent.revision).toBe(2);
    }
  });

  it("records batch via record_product_analytics_events RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        accepted_ids: ["33333333-3333-4333-8333-333333333333"],
        rejected_count: 0,
      },
      error: null,
    });
    const mockClient = { rpc } as any;
    const repo = new SupabaseProductAnalyticsRepository({
      client: mockClient,
    });

    const res = await repo.recordBatch(userId, {
      consentVersion: "product-analytics-v2",
      epoch,
      events: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          epoch,
          version: "product-analytics-v2",
          name: "screen_viewed",
          sessionId: "44444444-4444-4444-8444-444444444444",
          sequence: 0,
          platform: "ios",
          appVersion: "1.0.0",
          properties: { screen: "dashboard" },
          recordedAt: new Date("2026-09-13T08:00:00.000Z"),
        },
      ],
    });

    expect(rpc).toHaveBeenCalledWith(
      "record_product_analytics_events",
      expect.objectContaining({
        p_user_id: userId,
        p_epoch: epoch,
        p_version: "product-analytics-v2",
      }),
    );
    expect(res).toEqual({
      success: true,
      acceptedIds: ["33333333-3333-4333-8333-333333333333"],
      rejectedCount: 0,
    });
  });

  it("clears events via clear_product_analytics_events RPC", async () => {
    const newEpoch = "55555555-5555-4555-8555-555555555555";
    const rpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        cleared: true,
        new_epoch: newEpoch,
        revision: 3,
      },
      error: null,
    });
    const mockClient = { rpc } as any;
    const repo = new SupabaseProductAnalyticsRepository({
      client: mockClient,
    });

    const res = await repo.clearEvents(userId, { expectedRevision: 2 });
    expect(res).toEqual({
      success: true,
      cleared: true,
      newEpoch,
      revision: 3,
    });
  });
});
