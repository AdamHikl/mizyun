import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_ANALYTICS_CONSENT_VERSION,
  analyticsEventV2Schema,
  type AnalyticsConsentResponse,
} from "@mizyun/contracts";
import {
  NetworkAnalyticsClient,
  type AnalyticsStorageFile,
  type NetworkAnalyticsApiTransport,
} from "./network-analytics-client";
const hooks = vi.hoisted(() => ({
  refs: [] as any[],
  index: 0,
  effects: [] as (() => void | (() => void))[],
  listener: null as ((event?: { defaultPrevented: boolean }) => void) | null,
  track: vi.fn().mockResolvedValue({ recorded: true }),
  scopes: 0,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (initial: unknown) =>
    (hooks.refs[hooks.index++] ??= { current: initial }),
  useEffect: (effect: () => void | (() => void)) => {
    hooks.effects.push(effect);
  },
}));
vi.mock("expo-router", () => ({ useNavigation: () => navigation }));
vi.mock("@/composition/analytics-client", () => ({
  analyticsClient: {
    createFlowScope: () => ({ flowId: `hook-${++hooks.scopes}` }),
    track: hooks.track,
  },
}));
const navigation = {
  addListener: (
    _name: string,
    callback: (event?: { defaultPrevented: boolean }) => void,
  ) => {
    hooks.listener = callback;
    return () => {
      hooks.listener = null;
    };
  },
};
import {
  LoggingFlowMeasurement,
  useLoggingFlowMeasurement,
} from "./flow-measurement";

function file(value: string | null = null): AnalyticsStorageFile {
  return {
    get exists() {
      return value !== null;
    },
    text: async () => value ?? "",
    write: (next) => {
      value = next;
    },
    delete: () => {
      value = null;
    },
  };
}
function fixture(granted = true) {
  let epoch = 1;
  let consent: AnalyticsConsentResponse = {
    version: CURRENT_ANALYTICS_CONSENT_VERSION,
    granted,
    revision: 1,
    epoch: `00000000-0000-4000-8000-${String(epoch).padStart(12, "0")}`,
    consentedAt: new Date().toISOString(),
    revokedAt: null,
    updatedAt: new Date().toISOString(),
  };
  const queue = file();
  const consentFile = file(JSON.stringify(consent));
  const transport: NetworkAnalyticsApiTransport = {
    getConsent: async () => ({ ok: true, data: consent }),
    updateConsent: async (input) => {
      consent = {
        ...consent,
        granted: input.granted,
        revision: consent.revision + 1,
        epoch: `00000000-0000-4000-8000-${String(++epoch).padStart(12, "0")}`,
      };
      return { ok: true, data: consent };
    },
    ingestBatch: vi.fn(async () => ({ ok: false })),
    clearEvents: async () => ({ ok: false }),
    listEvents: async () => ({ ok: false }),
  };
  return {
    client: new NetworkAnalyticsClient(transport, consentFile, queue),
    transport,
  };
}
async function events(client: NetworkAnalyticsClient) {
  await client.getConsent();
  await client.flush();
  return client.list();
}
beforeEach(() => {
  hooks.refs = [];
  hooks.index = 0;
  hooks.effects = [];
  hooks.listener = null;
  hooks.scopes = 0;
  hooks.track.mockReset().mockResolvedValue({ recorded: true });
});

describe("scoped logging attempt measurement", () => {
  it("loads already granted cold consent and correlates overlapping attempts without attaching unrelated screens", async () => {
    const { client } = fixture();
    const meal = new LoggingFlowMeasurement("meal", client, 0, () => 45_000);
    const workout = new LoggingFlowMeasurement(
      "workout",
      client,
      0,
      () => 45_000,
    );
    meal.tap();
    meal.fail("submit", "network", true);
    meal.retry();
    workout.exit("navigate_away");
    meal.complete();
    meal.complete();
    meal.exit("cancel");
    meal.fail("submit", "server", true);
    await client.track({
      name: "screen_viewed",
      properties: { screen: "dashboard" },
    });
    const rows = await events(client);
    const mealRows = rows.filter(
      (event) =>
        ("flow" in event.properties && event.properties.flow === "meal") ||
        event.name === "core_record_created",
    );
    const workoutRows = rows.filter(
      (event) =>
        "flow" in event.properties && event.properties.flow === "workout",
    );
    expect(mealRows.map((event) => event.name)).toEqual([
      "logging_flow_started",
      "logging_flow_failed",
      "logging_flow_completed",
      "core_record_created",
    ]);
    expect(new Set(mealRows.map((event) => event.flowId)).size).toBe(1);
    expect(new Set(workoutRows.map((event) => event.flowId)).size).toBe(1);
    expect(mealRows[0].flowId).not.toBe(workoutRows[0].flowId);
    expect(
      rows.find((event) => event.name === "screen_viewed")?.flowId,
    ).toBeUndefined();
    expect(
      rows.every((event) => analyticsEventV2Schema.safeParse(event).success),
    ).toBe(true);
  });

  it("never emits a partial attempt after initial denied consent changes to granted", async () => {
    const { client, transport } = fixture(false);
    const attempt = new LoggingFlowMeasurement("meal", client);
    await client.getConsent();
    await client.setConsent("granted");
    attempt.complete();
    expect(await events(client)).toEqual([]);
    expect(transport.ingestBatch).not.toHaveBeenCalled();
  });

  it.each(["reset", "revoke"])(
    "cannot revive an old attempt after %s and new consent",
    async (boundary) => {
      const { client } = fixture();
      const old = new LoggingFlowMeasurement("meal", client);
      await events(client);
      if (boundary === "reset") {
        await client.resetLocalSession();
        await client.syncConsent();
      } else {
        await client.setConsent("denied");
        await client.setConsent("granted");
      }
      const next = new LoggingFlowMeasurement("workout", client);
      old.complete();
      old.exit("cancel");
      next.exit("cancel");
      const rows = await events(client);
      expect(rows.map((event) => event.name)).toEqual([
        "logging_flow_started",
        "logging_flow_exited",
      ]);
      expect(
        rows.every(
          (event) =>
            "flow" in event.properties && event.properties.flow === "workout",
        ),
      ).toBe(true);
    },
  );

  it("refuses fabricated or foreign client scopes", async () => {
    const { client } = fixture();
    const other = fixture().client;
    const foreign = other.createFlowScope();
    expect(
      await client.track(
        { name: "logging_flow_started", properties: { flow: "meal" } },
        foreign,
      ),
    ).toEqual({ recorded: false, reason: "consent_not_granted" });
    expect(
      await client.track(
        { name: "logging_flow_started", properties: { flow: "meal" } },
        { flowId: "private-record-id" },
      ),
    ).toEqual({ recorded: false, reason: "consent_not_granted" });
    expect(await client.list()).toEqual([]);
  });

  it("does not duplicate starts/exits during effect replay or cleanup and records actual route removal once", async () => {
    useLoggingFlowMeasurement("meal", "owner-a");
    const effect = hooks.effects.pop()!;
    const cleanup = effect();
    cleanup?.();
    effect();
    expect(hooks.track.mock.calls.map(([event]) => event.name)).toEqual([
      "logging_flow_started",
    ]);
    hooks.listener!();
    hooks.listener!();
    await Promise.resolve();
    expect(hooks.track.mock.calls.map(([event]) => event.name)).toEqual([
      "logging_flow_started",
      "logging_flow_exited",
    ]);
    hooks.index = 0;
    useLoggingFlowMeasurement("meal", "owner-b");
    hooks.effects.pop()!();
    expect(hooks.scopes).toBe(2);
  });

  it("keeps an attempt open when a later navigation listener prevents removal", async () => {
    const measurement = useLoggingFlowMeasurement("meal", "owner-a");
    const cleanup = hooks.effects.pop()!();
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    hooks.listener!(event);
    // React Navigation calls later listeners synchronously on the same event.
    event.preventDefault();
    await Promise.resolve();
    expect(hooks.track.mock.calls.map(([input]) => input.name)).toEqual([
      "logging_flow_started",
    ]);
    cleanup?.();
    expect(hooks.track).toHaveBeenCalledTimes(1);
    measurement.current!.complete();
    expect(hooks.track.mock.calls.map(([input]) => input.name)).toEqual([
      "logging_flow_started",
      "logging_flow_completed",
      "core_record_created",
    ]);
  });
});
