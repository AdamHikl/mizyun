import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import { fetchBetaProStatus, requestBetaProPass } from "./beta-pro-client";

describe("beta-pro-client", () => {
  describe("fetchBetaProStatus", () => {
    it("queries /v1/beta-pro/status and returns response", async () => {
      const mockResponse = {
        status: "none",
        requestedAt: null,
        reviewedAt: null,
      };
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: mockResponse,
      });
      const client = { request } as unknown as ApiClient;

      const result = await fetchBetaProStatus(client);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("none");
      }
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/v1/beta-pro/status",
        }),
      );
    });
  });

  describe("requestBetaProPass", () => {
    it("submits request with push token when available", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: { status: "pending" },
      });
      const client = { request } as unknown as ApiClient;

      const result = await requestBetaProPass(client, {
        getPushToken: async () => "ExponentPushToken[test-123]",
      });

      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: "/v1/beta-pro/request",
          body: {
            pushToken: "ExponentPushToken[test-123]",
          },
        }),
      );
    });

    it("submits request gracefully without push token when push token getter fails", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: { status: "pending" },
      });
      const client = { request } as unknown as ApiClient;

      const result = await requestBetaProPass(client, {
        getPushToken: async () => {
          throw new Error("Push notifications disabled");
        },
      });

      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          path: "/v1/beta-pro/request",
          body: {},
        }),
      );
    });

    it("returns error result if API request fails", async () => {
      const request = vi.fn().mockResolvedValue({
        ok: false,
        error: { kind: "http_error", status: 500, message: "Internal error" },
      });
      const client = { request } as unknown as ApiClient;

      const result = await requestBetaProPass(client, {
        getPushToken: async () => undefined,
      });

      expect(result.ok).toBe(false);
    });
  });
});
