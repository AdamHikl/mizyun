import { describe, expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DAILY: "daily", WEEKLY: "weekly" },
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import type { ApiClient } from "@mizyun/api-client";
import {
  clearLocalUserData,
  confirmAccountDeletion,
  fetchAccountExport,
  requestAccountDeletion,
  saveExportToFile,
} from "./account-data-management.js";

describe("account-data-management", () => {
  it("fetchAccountExport returns account data on success", async () => {
    const mockExport = {
      export: {
        userId: "00000000-0000-4000-8000-000000000001",
        generatedAt: "2026-09-08T10:00:00.000Z",
        profile: null,
        goals: [],
        foodEntries: [],
        exercises: [],
        workouts: [],
        workoutSets: [],
        bodyMeasurements: [],
        conversations: [],
        privateMedia: [],
        feedback: [],
      },
    };

    const client = {
      request: vi.fn().mockResolvedValue({ ok: true, value: mockExport }),
    } as unknown as ApiClient;

    const result = await fetchAccountExport(client);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.export.userId).toBe(
        "00000000-0000-4000-8000-000000000001",
      );
    }
  });

  it("fetchAccountExport returns actionable error on 401", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          kind: "http_error",
          status: 401,
          code: "UNAUTHORIZED",
          message: "unauthorized",
        },
      }),
    } as unknown as ApiClient;

    const result = await fetchAccountExport(client);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("must be signed in");
    }
  });

  it("requestAccountDeletion returns token on success", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          confirmationToken: "test-token-xyz",
          expiresAt: "2026-09-08T10:05:00.000Z",
        },
      }),
    } as unknown as ApiClient;

    const result = await requestAccountDeletion(client);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.confirmationToken).toBe("test-token-xyz");
    }
  });

  it("requestAccountDeletion distinguishes unauthorized from retryable errors", async () => {
    const authClient = {
      request: vi.fn().mockResolvedValue({
        ok: false,
        error: { kind: "http_error", status: 401, message: "unauthorized" },
      }),
    } as unknown as ApiClient;

    const authResult = await requestAccountDeletion(authClient);
    expect(authResult.ok).toBe(false);
    if (!authResult.ok) {
      expect(authResult.retryable).toBe(false);
      expect(authResult.message).toContain("must be signed in");
    }

    const netClient = {
      request: vi.fn().mockResolvedValue({
        ok: false,
        error: { kind: "network_error", message: "Failed to fetch" },
      }),
    } as unknown as ApiClient;

    const netResult = await requestAccountDeletion(netClient);
    expect(netResult.ok).toBe(false);
    if (!netResult.ok) {
      expect(netResult.retryable).toBe(true);
      expect(netResult.message).toContain("check your connection");
    }
  });

  it("confirmAccountDeletion succeeds with valid token", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        ok: true,
        value: { deleted: true },
      }),
    } as unknown as ApiClient;

    const result = await confirmAccountDeletion(client, "test-token-xyz");
    expect(result.ok).toBe(true);
  });

  it("confirmAccountDeletion classifies errors accurately with retryability", async () => {
    // 410 expired -> non-retryable
    const expiredClient = {
      request: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          kind: "http_error",
          status: 410,
          code: "VALIDATION_ERROR",
          message: "expired",
        },
      }),
    } as unknown as ApiClient;
    const expiredResult = await confirmAccountDeletion(
      expiredClient,
      "expired-token",
    );
    expect(expiredResult).toEqual({
      ok: false,
      retryable: false,
      reason: "expired",
      message: "The deletion request expired. Please request a new one.",
    });

    // 409 mismatch -> non-retryable
    const mismatchClient = {
      request: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          kind: "http_error",
          status: 409,
          code: "VALIDATION_ERROR",
          message: "mismatch",
        },
      }),
    } as unknown as ApiClient;
    const mismatchResult = await confirmAccountDeletion(
      mismatchClient,
      "wrong-token",
    );
    expect(mismatchResult).toEqual({
      ok: false,
      retryable: false,
      reason: "mismatch",
      message: "Invalid or mismatching deletion token. Please try again.",
    });

    // 503 server error -> retryable
    const serverErrClient = {
      request: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          kind: "http_error",
          status: 503,
          code: "SERVICE_UNAVAILABLE",
          message: "storage timeout",
        },
      }),
    } as unknown as ApiClient;
    const serverErrResult = await confirmAccountDeletion(
      serverErrClient,
      "preserved-token",
    );
    expect(serverErrResult).toEqual({
      ok: false,
      retryable: true,
      reason: "server_error",
      message:
        "Server or storage cleanup encountered a temporary issue. Your deletion request is preserved; please retry.",
    });

    // network_error -> retryable
    const networkClient = {
      request: vi.fn().mockResolvedValue({
        ok: false,
        error: { kind: "network_error", message: "timeout" },
      }),
    } as unknown as ApiClient;
    const networkResult = await confirmAccountDeletion(
      networkClient,
      "preserved-token",
    );
    expect(networkResult).toEqual({
      ok: false,
      retryable: true,
      reason: "network_error",
      message:
        "Network connection failed during deletion. Your deletion request is preserved; please retry.",
    });
  });

  it("clearLocalUserData wipes drafts, consent decisions, and coach reminders", async () => {
    const userId = "00000000-0000-4000-8000-000000000001";
    const draftMap = new Map<string, string>([
      [`mizyun.logging-draft.${userId}.meal`, '{"food":"Apple"}'],
      [`mizyun.logging-draft.${userId}.workout`, '{"name":"Chest Day"}'],
      [`mizyun.logging-draft.${userId}.weight`, '{"weight":80}'],
      [`mizyun.logging-draft.${userId}.coach`, '{"message":"Hi"}'],
    ]);
    const consentMap = new Map<string, string>([
      [`mizyun.ai-consent.${userId}`, '{"granted":true}'],
    ]);
    const reminderMap = new Map<string, string>([
      [
        `mizyun.coach-reminders.${userId}`,
        JSON.stringify({
          dailyEnabled: true,
          weeklyEnabled: false,
          hour: 19,
          minute: 0,
          weeklyWeekday: 1,
          notificationIds: ["notif-1", "notif-2"],
        }),
      ],
    ]);

    const draftStore = {
      getItemAsync: async (k: string) => draftMap.get(k) ?? null,
      setItemAsync: async (k: string, v: string) => {
        draftMap.set(k, v);
      },
      deleteItemAsync: async (k: string) => {
        draftMap.delete(k);
      },
    };

    const consentStore = {
      getItemAsync: async (k: string) => consentMap.get(k) ?? null,
      setItemAsync: async (k: string, v: string) => {
        consentMap.set(k, v);
      },
      deleteItemAsync: async (k: string) => {
        consentMap.delete(k);
      },
    };

    const reminderStore = {
      getItemAsync: async (k: string) => reminderMap.get(k) ?? null,
      setItemAsync: async (k: string, v: string) => {
        reminderMap.set(k, v);
      },
      deleteItemAsync: async (k: string) => {
        reminderMap.delete(k);
      },
    };

    const cancelledNotifications: string[] = [];
    const reminderScheduler = {
      ensureChannel: async () => undefined,
      getPermission: async () => "granted" as const,
      requestPermission: async () => "granted" as const,
      schedule: async () => "notif-x",
      cancel: async (id: string) => {
        cancelledNotifications.push(id);
      },
    };

    await clearLocalUserData(userId, {
      draftStore,
      consentStore,
      reminderStore,
      reminderScheduler,
    });

    expect(draftMap.size).toBe(0);
    expect(consentMap.size).toBe(0);
    expect(reminderMap.size).toBe(0);
    expect(cancelledNotifications).toEqual(["notif-1", "notif-2"]);
  });

  it("saveExportToFile writes formatted JSON to file and returns fileUri and byteSize", async () => {
    let writtenContent = "";
    const mockFile = {
      uri: "file:///documents/mizyun-account-export-2026.json",
      write: (content: string) => {
        writtenContent = content;
      },
    };

    const mockExport = {
      export: {
        userId: "00000000-0000-4000-8000-000000000001",
        generatedAt: "2026-09-08T10:00:00.000Z",
        profile: null,
        goals: [],
        foodEntries: [],
        exercises: [],
        workouts: [],
        workoutSets: [],
        bodyMeasurements: [],
        conversations: [],
        memories: [],
        privateMedia: [
          {
            id: "00000000-0000-4000-8000-0000000000aa",
            objectPath: "photo.jpg",
            downloadUrl: "https://example.com/download/photo.jpg",
            createdAt: "2026-09-08T10:00:00.000Z",
          },
        ],
        feedback: [],
      },
    };

    const result = await saveExportToFile(mockExport as any, () => mockFile);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fileUri).toBe(
        "file:///documents/mizyun-account-export-2026.json",
      );
      expect(result.byteSize).toBeGreaterThan(0);
      expect(result.fileName).toMatch(/^mizyun-account-export-.*\.json$/);
    }
    expect(writtenContent).toContain("https://example.com/download/photo.jpg");
    expect(writtenContent).toContain("00000000-0000-4000-8000-000000000001");
  });

  it("saveExportToFile handles write errors gracefully", async () => {
    const errorFile = {
      uri: "file:///documents/error.json",
      write: () => {
        throw new Error("Disk full");
      },
    };

    const result = await saveExportToFile(
      { export: {} } as any,
      () => errorFile,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Could not save account data export");
    }
  });
});
