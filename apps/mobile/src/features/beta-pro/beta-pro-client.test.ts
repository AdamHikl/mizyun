import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import {
  fetchBetaProStatus,
  registerDevicePushToken,
  requestBetaProPass,
  requestSetupNotificationPermission,
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
const mockSetNotificationChannelAsync = vi.fn().mockResolvedValue(null);

vi.mock("expo-notifications", () => ({
  getPermissionsAsync: () => mockGetPermissionsAsync(),
  requestPermissionsAsync: () => mockRequestPermissionsAsync(),
  getDevicePushTokenAsync: () => mockGetDevicePushTokenAsync(),
  getExpoPushTokenAsync: () => mockGetExpoPushTokenAsync(),
  setNotificationChannelAsync: (...args: unknown[]) =>
    mockSetNotificationChannelAsync(...args),
  AndroidImportance: { DEFAULT: 3 },
}));

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

describe("beta-pro-client", () => {
  describe("setup notification permission", () => {
    it("creates the Android channel before requesting permission", async () => {
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        canAskAgain: true,
      });
      mockRequestPermissionsAsync.mockResolvedValueOnce({ granted: true });
      expect(await requestSetupNotificationPermission()).toBe("granted");
      expect(mockSetNotificationChannelAsync).toHaveBeenCalledWith(
        "general-updates",
        expect.objectContaining({ name: "Mizyun updates" }),
      );
      expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(
        mockSetNotificationChannelAsync.mock.invocationCallOrder[0],
      ).toBeLessThan(mockRequestPermissionsAsync.mock.invocationCallOrder[0]!);
    });
  });
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
      mockRequestPermissionsAsync.mockClear();
      mockGetPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        canAskAgain: false,
      });

      const request = vi.fn();
      const client = { request } as unknown as ApiClient;

      const token = await registerDevicePushToken(client);
      expect(token).toBeNull();
      expect(request).not.toHaveBeenCalled();
      expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    });
  });
});
