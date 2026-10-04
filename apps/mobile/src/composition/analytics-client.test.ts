import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  os: "ios",
  config: {
    version: "1.0.6",
    ios: { buildNumber: "6" },
    android: { versionCode: 6 },
  } as any,
  constructor: vi.fn(),
  request: vi.fn(),
}));
vi.mock("expo-constants", () => ({
  default: {
    get expoConfig() {
      return mocks.config;
    },
  },
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mocks.os;
    },
  },
}));
vi.mock("@/composition/api-client", () => ({
  apiClient: { request: mocks.request },
}));
vi.mock("@/features/analytics/network-analytics-client", () => ({
  NetworkAnalyticsClient: class {
    constructor(...args: unknown[]) {
      mocks.constructor(...args);
    }
  },
}));

beforeEach(() => {
  vi.resetModules();
  mocks.constructor.mockReset();
  mocks.request
    .mockReset()
    .mockResolvedValue({ ok: true, value: { events: [] } });
  mocks.os = "ios";
  mocks.config = {
    version: "1.0.6",
    ios: { buildNumber: "6" },
    android: { versionCode: 6 },
  };
});

describe("analytics release metadata composition", () => {
  it("explicitly requests the current event catalog for analytics export", async () => {
    const { createApiTransport } = await import("./analytics-client");
    expect(await createApiTransport().listEvents()).toEqual({
      ok: true,
      data: { events: [] },
    });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/v1/analytics/events?catalog=dashboard-v1",
      }),
    );
  });
  it.each(["ios", "android"])(
    "passes the embedded %s release tuple to the uploader",
    async (os) => {
      mocks.os = os;
      await import("./analytics-client");
      expect(mocks.constructor.mock.calls[0].slice(4)).toEqual(["1.0.6", "6"]);
    },
  );

  it("labels missing metadata as unknown and does not invent a build", async () => {
    mocks.config = null;
    await import("./analytics-client");
    expect(mocks.constructor.mock.calls[0].slice(4)).toEqual([
      "unknown",
      undefined,
    ]);
  });
});
