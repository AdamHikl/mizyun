import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/composition/api-client";
import { submitFeedback, loadUserFeedback } from "./feedback-data";

vi.mock("@/composition/api-client", () => ({
  apiClient: {
    request: vi.fn(),
  },
}));

describe("feedback-data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("submits valid feedback successfully", async () => {
    const mockResponse = {
      feedback: {
        id: "00000000-0000-4000-8000-000000000001",
        userId: "00000000-0000-4000-8000-000000000002",
        category: "like" as const,
        rating: 5,
        message: "Amazing app!",
        context: {},
        createdAt: "2026-08-24T10:00:00.000Z",
      },
    };

    vi.mocked(apiClient.request).mockResolvedValueOnce({
      ok: true,
      value: mockResponse,
    });

    const result = await submitFeedback({
      category: "like",
      rating: 5,
      message: "Amazing app!",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.feedback.id).toBe("00000000-0000-4000-8000-000000000001");
      expect(result.feedback.category).toBe("like");
    }
  });

  it("fails locally when message is empty without calling api", async () => {
    const result = await submitFeedback({
      category: "bug",
      message: "   ",
    });

    expect(result.ok).toBe(false);
    expect(apiClient.request).not.toHaveBeenCalled();
  });

  it("handles api error on submission", async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "http_error",
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Server error occurred.",
      },
    });

    const result = await submitFeedback({
      category: "change",
      message: "Add more widgets",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("Server error occurred.");
    }
  });

  it("loads user feedback successfully", async () => {
    const mockList = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        userId: "00000000-0000-4000-8000-000000000002",
        category: "change" as const,
        rating: null,
        message: "Add watch support",
        context: {},
        createdAt: "2026-08-24T10:00:00.000Z",
      },
    ];

    vi.mocked(apiClient.request).mockResolvedValueOnce({
      ok: true,
      value: { feedback: mockList },
    });

    const result = await loadUserFeedback();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.feedback).toHaveLength(1);
    }
  });
});
