import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import { apiClient } from "@/composition/api-client";
import {
  submitFeedback,
  loadUserFeedback,
  uploadFeedbackAttachment,
  type PreparedFeedbackAttachment,
} from "./feedback-data";

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
        mediaAssetIds: ["00000000-0000-4000-8000-00000000a001"],
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
      mediaAssetIds: ["00000000-0000-4000-8000-00000000a001"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.feedback.id).toBe("00000000-0000-4000-8000-000000000001");
      expect(result.feedback.category).toBe("like");
      expect(result.feedback.mediaAssetIds).toEqual([
        "00000000-0000-4000-8000-00000000a001",
      ]);
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
        mediaAssetIds: [],
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

  it("uploads feedback attachment successfully", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      ok: true,
      value: {
        assetId: "00000000-0000-4000-8000-00000000a001",
        uploadUrl: "https://upload.example.com/asset-1",
      },
    });
    const client = { request } as unknown as ApiClient;
    const uploadFile = vi.fn().mockResolvedValueOnce({ ok: true, status: 200 });

    const photo: PreparedFeedbackAttachment = {
      uri: "file:///path/to/screenshot.jpg",
      mimeType: "image/jpeg",
      byteSize: 204800,
      width: 1080,
      height: 1920,
    };

    const result = await uploadFeedbackAttachment(photo, client, uploadFile);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assetId).toBe("00000000-0000-4000-8000-00000000a001");
    }
    expect(uploadFile).toHaveBeenCalledWith(
      "https://upload.example.com/asset-1",
      photo,
    );
  });
});
