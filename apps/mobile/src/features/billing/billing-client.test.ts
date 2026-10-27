import type { ApiClient } from "@mizyun/api-client";
import { billingEntitlementResponseSchema } from "@mizyun/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  fetchBillingEntitlement,
  syncBillingEntitlement,
} from "./billing-client";

const response = {
  planTier: "free",
  paidSource: "none",
  purchasesEnabled: false,
  entitlement: null,
  storeSdk: null,
};

describe("billing-client", () => {
  it("reads the entitlement with GET and no body", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, value: response });
    const result = await fetchBillingEntitlement({
      request,
    } as unknown as ApiClient);
    expect(result.ok).toBe(true);
    const call = request.mock.calls[0]![0];
    expect(call.method).toBe("GET");
    expect(call.path).toBe("/v1/billing/entitlement");
    expect(call.schema).toBe(billingEntitlementResponseSchema);
    expect(call.body).toBeUndefined();
  });

  it("syncs with POST and sends no entitlement or receipt", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, value: response });
    await syncBillingEntitlement({ request } as unknown as ApiClient);
    const call = request.mock.calls[0]![0];
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/v1/billing/entitlement/sync");
    expect(call.body).toBeUndefined();
  });

  it("passes API failures through unchanged", async () => {
    const error = { code: "network" };
    const request = vi.fn().mockResolvedValue({ ok: false, error });
    const result = await fetchBillingEntitlement({
      request,
    } as unknown as ApiClient);
    expect(result).toEqual({ ok: false, error });
  });
});
