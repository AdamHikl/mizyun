import { afterEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ module: null as unknown }));
vi.mock("expo", () => ({
  requireOptionalNativeModule: () => bridge.module,
}));

afterEach(() => {
  vi.resetModules();
  bridge.module = null;
});

const fields = [
  { name: "activityName", description: "The main physical activity" },
] as const;

describe("on-device LLM native boundary", () => {
  it("reports unsupported without a native module and rejects generation", async () => {
    const module = await import("./index");
    expect(await module.getOnDeviceLlmAvailability()).toBe("unsupported");
    await expect(module.prewarmOnDeviceLlm("instructions")).resolves.toBe(
      undefined,
    );
    await expect(
      module.generateOnDeviceFields("instructions", "prompt", fields, 40, 5000),
    ).rejects.toThrow("not supported");
  });

  it("passes a known availability through and maps an unknown one to unavailable", async () => {
    const getAvailability = vi
      .fn()
      .mockResolvedValueOnce("available")
      .mockResolvedValueOnce("model_not_ready")
      .mockResolvedValueOnce("something_new");
    bridge.module = { getAvailability };
    const module = await import("./index");
    expect(await module.getOnDeviceLlmAvailability()).toBe("available");
    expect(await module.getOnDeviceLlmAvailability()).toBe("model_not_ready");
    expect(await module.getOnDeviceLlmAvailability()).toBe("unavailable");
  });

  it("prewarms the native model with the instructions", async () => {
    const prewarm = vi.fn().mockResolvedValue(undefined);
    bridge.module = { prewarm };
    const module = await import("./index");
    await module.prewarmOnDeviceLlm("be brief");
    expect(prewarm).toHaveBeenCalledWith("be brief");
  });

  it("passes the arguments through and returns only the requested fields", async () => {
    const generateFields = vi
      .fn()
      .mockResolvedValue({ activityName: "Yardwork", extra: "ignored" });
    bridge.module = { generateFields };
    const module = await import("./index");
    const result = await module.generateOnDeviceFields(
      "instructions",
      "prompt",
      fields,
      40,
      5000,
    );
    expect(generateFields).toHaveBeenCalledWith(
      "instructions",
      "prompt",
      fields,
      40,
      5000,
    );
    expect(result).toEqual({ activityName: "Yardwork" });
  });

  it("rejects when a requested field is missing or not a string", async () => {
    const generateFields = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ activityName: 7 });
    bridge.module = { generateFields };
    const module = await import("./index");
    await expect(
      module.generateOnDeviceFields("i", "p", fields, 40, 5000),
    ).rejects.toThrow("omitted activityName");
    await expect(
      module.generateOnDeviceFields("i", "p", fields, 40, 5000),
    ).rejects.toThrow("omitted activityName");
  });

  it("lets a native failure reject", async () => {
    bridge.module = {
      generateFields: vi.fn().mockRejectedValue(new Error("guardrail")),
    };
    const module = await import("./index");
    await expect(
      module.generateOnDeviceFields("i", "p", fields, 40, 5000),
    ).rejects.toThrow("guardrail");
  });
});
