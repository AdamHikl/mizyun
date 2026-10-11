import { describe, expect, it, vi } from "vitest";
import { loadAutomaticMealIllustration } from "./meal-illustration-loader";

const ready = {
  ok: true as const,
  value: {
    status: "ready" as const,
    image: { base64: "ZmFrZQ==", mimeType: "image/jpeg" as const, key: "key" },
  },
};
function setup() {
  const controller = new AbortController();
  return {
    client: {
      getMealIllustrationCapability: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { available: true } }),
      ensureMealIllustration: vi.fn().mockResolvedValue(ready),
    },
    entryId: "meal-a",
    owner: "owner-a",
    signal: controller.signal,
    controller,
    isCurrent: vi.fn(() => true),
    onReady: vi.fn(),
    pause: vi.fn().mockResolvedValue(undefined),
  };
}
describe("background decorative generation", () => {
  it("checks capability and binds every request to the originating account", async () => {
    const args = setup();
    await loadAutomaticMealIllustration(args);
    expect(args.client.ensureMealIllustration).toHaveBeenCalledWith(
      "meal-a",
      expect.objectContaining({
        expectedUserId: "owner-a",
        signal: args.signal,
      }),
    );
    expect(args.onReady).toHaveBeenCalledWith(
      "data:image/jpeg;base64,ZmFrZQ==",
    );
  });
  it("keeps the fallback when generation is disabled or transport fails", async () => {
    const args = setup();
    args.client.getMealIllustrationCapability.mockResolvedValue({
      ok: true,
      value: { available: false },
    });
    await loadAutomaticMealIllustration(args);
    expect(args.client.ensureMealIllustration).not.toHaveBeenCalled();
    args.client.getMealIllustrationCapability.mockRejectedValue(
      new Error("offline"),
    );
    await loadAutomaticMealIllustration(args);
    expect(args.onReady).not.toHaveBeenCalled();
  });
  it("ignores a late result after account, token or meal-name change", async () => {
    const args = setup();
    args.client.ensureMealIllustration.mockImplementation(async () => {
      args.isCurrent.mockReturnValue(false);
      return ready;
    });
    await loadAutomaticMealIllustration(args);
    expect(args.onReady).not.toHaveBeenCalled();
  });
  it("bounds pending polling and stops immediately on cancellation", async () => {
    const args = setup();
    args.client.ensureMealIllustration.mockResolvedValue({
      ok: true,
      value: { status: "pending" },
    });
    await loadAutomaticMealIllustration(args);
    expect(args.client.ensureMealIllustration).toHaveBeenCalledTimes(8);
    expect(args.pause).toHaveBeenCalledTimes(7);
    args.client.ensureMealIllustration.mockClear();
    args.controller.abort();
    await loadAutomaticMealIllustration(args);
    expect(args.client.ensureMealIllustration).not.toHaveBeenCalled();
  });
  it("stops pending polling when consent is revoked or the feature becomes unavailable", async () => {
    const args = setup();
    args.client.ensureMealIllustration
      .mockResolvedValueOnce({ ok: true, value: { status: "pending" } })
      .mockResolvedValueOnce({ ok: true, value: { status: "unavailable" } });
    await loadAutomaticMealIllustration(args);
    expect(args.client.ensureMealIllustration).toHaveBeenCalledTimes(2);
    expect(args.onReady).not.toHaveBeenCalled();
  });
});
