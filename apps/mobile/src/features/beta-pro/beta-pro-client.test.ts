import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import {
  fetchBetaProStatus,
  registerDevicePushToken,
  registerDevicePushTokenAfterFirstRecord,
  pushPromptAllowed,
  requestBetaProPass,
} from "./beta-pro-client";

const mockGetPermissionsAsync = vi.fn().mockResolvedValue({ granted: true });
const mockRequestPermissionsAsync = vi
  .fn()
  .mockResolvedValue({ granted: true });
const mockGetDevicePushTokenAsync = vi
  .fn()
  .mockResolvedValue({ data: "mock-apns-token" });
const mockGetExpoPushTokenAsync = vi
  .fn()
  .mockResolvedValue({ data: "ExponentPushToken[mock]" });

vi.mock("expo-notifications", () => ({
  getPermissionsAsync: () => mockGetPermissionsAsync(),
  requestPermissionsAsync: () => mockRequestPermissionsAsync(),
  getDevicePushTokenAsync: () => mockGetDevicePushTokenAsync(),
  getExpoPushTokenAsync: () => mockGetExpoPushTokenAsync(),
}));

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

  describe("registerDevicePushToken", () => {
    it("registers the device token without submitting a Beta Pro request", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({ granted: true });
      mockGetDevicePushTokenAsync.mockResolvedValueOnce({
        data: "mock-apns-token-xyz",
      });

      const request = vi.fn().mockResolvedValue({
        ok: true,
        value: { updated: true },
      });
      const client = { request } as unknown as ApiClient;

      const token = await registerDevicePushToken(client);
      expect(token).toBe("mock-apns-token-xyz");
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "PUT",
          path: "/v1/beta-pro/push-token",
          body: { pushToken: "mock-apns-token-xyz" },
        }),
      );
    });

    it("does not report registration when there is no existing pass request", async () => {
      const request = vi
        .fn()
        .mockResolvedValue({ ok: true, value: { updated: false } });
      expect(
        await registerDevicePushToken({ request } as unknown as ApiClient),
      ).toBeNull();
      expect(request).toHaveBeenCalledTimes(1);
    });

    it("returns null when permissions are not granted", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        canAskAgain: false,
      });

      const request = vi.fn();
      const client = { request } as unknown as ApiClient;

      const token = await registerDevicePushToken(client);
      expect(token).toBeNull();
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe("registerDevicePushTokenAfterFirstRecord", () => {
    const client = (updated = true) =>
      ({
        request: vi.fn().mockResolvedValue({ ok: true, value: { updated } }),
      }) as unknown as ApiClient;

    it("does not ask the OS before the first confirmed record", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        canAskAgain: true,
      });
      mockRequestPermissionsAsync.mockClear();
      const api = client();

      const result = await registerDevicePushTokenAfterFirstRecord(
        api,
        async () => false,
      );

      expect(result).toEqual({ deferred: true, token: null });
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
      expect(api.request).not.toHaveBeenCalled();
    });

    it("asks once the first record is confirmed", async () => {
      mockGetPermissionsAsync
        .mockResolvedValueOnce({ granted: false, canAskAgain: true })
        .mockResolvedValueOnce({ granted: false, canAskAgain: true });
      mockRequestPermissionsAsync.mockClear();
      mockRequestPermissionsAsync.mockResolvedValueOnce({ granted: true });
      mockGetDevicePushTokenAsync.mockResolvedValueOnce({ data: "tok" });

      const result = await registerDevicePushTokenAfterFirstRecord(
        client(),
        async () => true,
      );

      expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ deferred: false, token: "tok" });
    });

    it("registers without waiting when the device already decided", async () => {
      mockGetPermissionsAsync
        .mockResolvedValueOnce({ granted: true })
        .mockResolvedValueOnce({ granted: true });
      mockGetDevicePushTokenAsync.mockResolvedValueOnce({ data: "tok2" });
      const gate = vi.fn().mockResolvedValue(false);

      const result = await registerDevicePushTokenAfterFirstRecord(
        client(),
        gate,
      );

      expect(gate).not.toHaveBeenCalled();
      expect(result).toEqual({ deferred: false, token: "tok2" });
    });

    it("keeps deferring when the record check fails", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        canAskAgain: true,
      });
      const result = await registerDevicePushTokenAfterFirstRecord(
        client(),
        async () => {
          throw new Error("store unavailable");
        },
      );
      expect(result.deferred).toBe(true);
    });
  });

  describe("pushPromptAllowed", () => {
    const base = { profileSetUp: false, preview: false };

    it("defers for a new account with no anchor and no profile", () => {
      expect(pushPromptAllowed({ ...base, anchor: null })).toBe(false);
    });

    it("defers while the anchor has no first record, even with a profile", () => {
      expect(
        pushPromptAllowed({
          anchor: { firstRecordOn: null },
          profileSetUp: true,
          preview: false,
        }),
      ).toBe(false);
    });

    it("allows after the first record", () => {
      expect(
        pushPromptAllowed({ ...base, anchor: { firstRecordOn: "2026-10-30" } }),
      ).toBe(true);
    });

    it("allows a set-up profile without an anchor (skipped card, new device)", () => {
      expect(
        pushPromptAllowed({ anchor: null, profileSetUp: true, preview: false }),
      ).toBe(true);
    });

    it("never allows preview mode", () => {
      expect(
        pushPromptAllowed({
          anchor: { firstRecordOn: "2026-10-30" },
          profileSetUp: true,
          preview: true,
        }),
      ).toBe(false);
    });
  });
});
