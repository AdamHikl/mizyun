import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";

import {
  confirmAccountDeletion,
  fetchAccountExport,
  requestAccountDeletion,
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

  it("confirmAccountDeletion returns expired message on 410", async () => {
    const client = {
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

    const result = await confirmAccountDeletion(client, "expired-token");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("expired");
    }
  });
});
