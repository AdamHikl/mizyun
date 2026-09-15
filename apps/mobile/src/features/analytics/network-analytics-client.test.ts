import { describe, expect, it, vi } from "vitest";
import {
  NetworkAnalyticsClient,
  type AnalyticsStorageFile,
  type NetworkAnalyticsApiTransport,
} from "./network-analytics-client";
import {
  CURRENT_ANALYTICS_CONSENT_VERSION,
  type AnalyticsBatchIngestResponse,
  type AnalyticsClearResponse,
  type AnalyticsConsentResponse,
  type AnalyticsEventV2,
} from "@mizyun/contracts";

const createMemoryFile = (): AnalyticsStorageFile => {
  let content: string | null = null;
  return {
    get exists() {
      return content !== null;
    },
    text: async () => content ?? "",
    write: (next: string) => {
      content = next;
    },
    delete: () => {
      content = null;
    },
  };
};

const createMockTransport = (): NetworkAnalyticsApiTransport & {
  consentCalls: any[];
  batchCalls: any[];
  clearCalls: any[];
  listCalls: any[];
  serverConsent: AnalyticsConsentResponse;
  serverEvents: AnalyticsEventV2[];
} => {
  const state = {
    consentCalls: [] as any[],
    batchCalls: [] as any[],
    clearCalls: [] as any[],
    listCalls: [] as any[],
    serverConsent: {
      version: CURRENT_ANALYTICS_CONSENT_VERSION,
      granted: false,
      revision: 0,
      epoch: "epoch-1",
      consentedAt: null,
      revokedAt: null,
      updatedAt: new Date().toISOString(),
    } as AnalyticsConsentResponse,
    serverEvents: [] as AnalyticsEventV2[],

    async getConsent() {
      state.consentCalls.push({ action: "get" });
      return { ok: true, data: state.serverConsent };
    },

    async updateConsent(input: any) {
      state.consentCalls.push({ action: "update", input });
      state.serverConsent = {
        version: input.version,
        granted: input.granted,
        revision: input.expectedRevision + 1,
        epoch: input.granted ? "epoch-new" : "epoch-revoked",
        consentedAt: input.granted ? new Date().toISOString() : null,
        revokedAt: input.granted ? null : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return { ok: true, data: state.serverConsent };
    },

    async ingestBatch(input: any) {
      state.batchCalls.push(input);
      state.serverEvents.push(...input.events);
      return {
        ok: true,
        data: {
          acceptedIds: input.events.map((e: AnalyticsEventV2) => e.id),
          rejectedCount: 0,
        } as AnalyticsBatchIngestResponse,
      };
    },

    async clearEvents(input: any) {
      state.clearCalls.push(input);
      state.serverEvents = [];
      return {
        ok: true,
        data: {
          cleared: true,
          newEpoch: "epoch-cleared",
          revision: input.expectedRevision + 1,
        } as AnalyticsClearResponse,
      };
    },

    async listEvents() {
      state.listCalls.push({});
      return {
        ok: true,
        data: { events: state.serverEvents },
      };
    },
  };
  return state;
};

describe("NetworkAnalyticsClient", () => {
  it("recovers an explicit retry after a committed grant response was lost", async () => {
    const transport = createMockTransport();
    const update = transport.updateConsent;
    let loseResponse = true;
    transport.updateConsent = vi.fn(async (input) => {
      if (input.expectedRevision !== transport.serverConsent.revision) {
        return { ok: false, conflict: true };
      }
      const result = await update(input);
      if (loseResponse) {
        loseResponse = false;
        return { ok: false };
      }
      return result;
    });
    const client = new NetworkAnalyticsClient(
      transport,
      createMemoryFile(),
      createMemoryFile(),
    );
    expect(await client.setConsent("granted")).toBe(false);
    expect(transport.serverConsent.granted).toBe(true);
    expect(await client.track({ name: "onboarding_started" })).toEqual({
      recorded: false,
      reason: "consent_not_granted",
    });
    await client.flush();
    expect(transport.updateConsent).toHaveBeenCalledTimes(1);
    expect(await client.setConsent("granted")).toBe(true);
    expect(await client.getConsent()).toBe("granted");
    expect(transport.updateConsent).toHaveBeenCalledTimes(3);
    expect(transport.updateConsent).toHaveBeenLastCalledWith(
      expect.objectContaining({ granted: true, expectedRevision: 1 }),
    );
  });

  it("rebases an explicit grant once without adopting the refreshed consent", async () => {
    const transport = createMockTransport();
    transport.serverConsent = {
      ...transport.serverConsent,
      revision: 7,
      granted: false,
    };
    const update = transport.updateConsent;
    const calls: Parameters<
      NetworkAnalyticsApiTransport["updateConsent"]
    >[0][] = [];
    transport.updateConsent = async (input) => {
      calls.push(input);
      return input.expectedRevision === 7
        ? update(input)
        : { ok: false, conflict: true };
    };
    const client = new NetworkAnalyticsClient(
      transport,
      createMemoryFile(),
      createMemoryFile(),
    );
    expect(await client.setConsent("granted")).toBe(true);
    expect(calls.map((call) => call.expectedRevision)).toEqual([0, 7]);
    expect(calls[0].operationId).not.toBe(calls[1].operationId);
    expect(transport.serverConsent.granted).toBe(true);
  });

  it("stops after a second conflict and leaves collection off", async () => {
    const transport = createMockTransport();
    transport.serverConsent = {
      ...transport.serverConsent,
      revision: 3,
      granted: true,
    };
    transport.updateConsent = vi.fn(async () => ({
      ok: false,
      conflict: true,
    }));
    const client = new NetworkAnalyticsClient(
      transport,
      createMemoryFile(),
      createMemoryFile(),
    );
    expect(await client.setConsent("granted")).toBe(false);
    expect(transport.updateConsent).toHaveBeenCalledTimes(2);
    expect(await client.getConsent()).toBe("unknown");
  });

  it.each(["unavailable", "throws"])(
    "keeps collection off when conflict refresh %s",
    async (failure) => {
      const transport = createMockTransport();
      transport.updateConsent = vi.fn(async () => ({
        ok: false,
        conflict: true,
      }));
      transport.getConsent = async () => {
        if (failure === "throws") throw new Error("offline");
        return { ok: false };
      };
      const client = new NetworkAnalyticsClient(
        transport,
        createMemoryFile(),
        createMemoryFile(),
      );
      expect(await client.setConsent("granted")).toBe(false);
      expect(transport.updateConsent).toHaveBeenCalledTimes(1);
      expect(await client.getConsent()).toBe("unknown");
    },
  );

  it("persists an offline denial and recovers its stale revision without installing a remote grant", async () => {
    const transport = createMockTransport();
    const consentFile = createMemoryFile();
    const queueFile = createMemoryFile();
    const client = new NetworkAnalyticsClient(
      transport,
      consentFile,
      queueFile,
    );
    await client.setConsent("granted");
    const update = transport.updateConsent;
    transport.updateConsent = async () => {
      throw new Error("offline");
    };
    expect(await client.setConsent("denied")).toBe(true);
    expect(await client.getConsent()).toBe("denied");
    transport.serverConsent = {
      ...transport.serverConsent,
      revision: 5,
      granted: true,
    };
    const restarted = new NetworkAnalyticsClient(
      transport,
      consentFile,
      queueFile,
    );
    transport.updateConsent = vi.fn(async (input) => {
      expect(JSON.parse(await consentFile.text()).granted).toBe(false);
      return input.expectedRevision === 5
        ? update(input)
        : { ok: false, conflict: true };
    });
    await restarted.syncConsent();
    expect(transport.updateConsent).toHaveBeenCalledTimes(2);
    expect(transport.serverConsent.granted).toBe(false);
    expect(JSON.parse(await consentFile.text()).pendingDenial).toBe(false);
    expect(await restarted.getConsent()).toBe("denied");
  });

  it("retains pending denial when its bounded recovery still conflicts", async () => {
    const transport = createMockTransport();
    const consentFile = createMemoryFile();
    transport.serverConsent = {
      ...transport.serverConsent,
      revision: 5,
      granted: true,
    };
    transport.updateConsent = vi.fn(async () => ({
      ok: false,
      conflict: true,
    }));
    const client = new NetworkAnalyticsClient(
      transport,
      consentFile,
      createMemoryFile(),
    );
    expect(await client.setConsent("denied")).toBe(true);
    await client.flush();
    expect(transport.updateConsent).toHaveBeenCalledTimes(4);
    expect(JSON.parse(await consentFile.text())).toMatchObject({
      granted: false,
      pendingDenial: true,
    });
    expect(await client.track({ name: "onboarding_started" })).toMatchObject({
      recorded: false,
    });
  });
  it("defaults to unknown consent and prevents tracking", async () => {
    const transport = createMockTransport();
    const consentFile = createMemoryFile();
    const queueFile = createMemoryFile();
    const client = new NetworkAnalyticsClient(
      transport,
      consentFile,
      queueFile,
      () => 1000000,
      "1.0.0",
    );

    expect(await client.getConsent()).toBe("unknown");
    const result = await client.track({
      name: "screen_viewed",
      properties: { screen: "dashboard" },
    });
    expect(result.recorded).toBe(false);
    expect(result.reason).toBe("consent_not_granted");
  });

  it("grants consent and successfully logs and flushes events", async () => {
    const transport = createMockTransport();
    const consentFile = createMemoryFile();
    const queueFile = createMemoryFile();
    let time = 1000000;
    const client = new NetworkAnalyticsClient(
      transport,
      consentFile,
      queueFile,
      () => time,
      "1.0.0",
    );

    const granted = await client.setConsent("granted");
    expect(granted).toBe(true);
    expect(await client.getConsent()).toBe("granted");
    expect(transport.consentCalls).toHaveLength(1);

    const trackResult = await client.track({
      name: "screen_viewed",
      properties: { screen: "dashboard" },
    });
    expect(trackResult.recorded).toBe(true);

    // After track, flush is triggered automatically
    await client.flush();
    expect(transport.batchCalls).toHaveLength(1);
    expect(transport.batchCalls[0].events).toHaveLength(1);
    expect(transport.batchCalls[0].events[0].name).toBe("screen_viewed");
    expect(transport.batchCalls[0].events[0].properties).toEqual({
      screen: "dashboard",
    });
  });

  it("denies consent and clears local queue immediately", async () => {
    const transport = createMockTransport();
    const consentFile = createMemoryFile();
    const queueFile = createMemoryFile();
    const client = new NetworkAnalyticsClient(
      transport,
      consentFile,
      queueFile,
      () => 1000000,
      "1.0.0",
    );

    await client.setConsent("granted");
    await client.track({
      name: "screen_viewed",
      properties: { screen: "settings" },
    });

    const denied = await client.setConsent("denied");
    expect(denied).toBe(true);
    expect(await client.getConsent()).toBe("denied");
    expect(await client.list()).toHaveLength(0);
  });

  it("does not restore a queued remainder when consent is denied during an in-flight flush", async () => {
    const transport = createMockTransport();
    const consentFile = createMemoryFile();
    const queueFile = createMemoryFile();
    const client = new NetworkAnalyticsClient(
      transport,
      consentFile,
      queueFile,
      () => 1000000,
      "1.0.0",
    );
    await client.setConsent("granted");

    const events = Array.from({ length: 51 }, (_, index) => ({
      id: `event-${index}`,
      schemaVersion: 2 as const,
      recordedAt: new Date(1000000 + index).toISOString(),
      sessionId: "session-1",
      sequence: index,
      platform: "ios" as const,
      appVersion: "1.0.0",
      name: "onboarding_started" as const,
      properties: {},
    }));
    queueFile.write(JSON.stringify(events));

    let releaseIngest!: (value: {
      ok: true;
      data: AnalyticsBatchIngestResponse;
    }) => void;
    const ingestStarted = new Promise<void>((resolve) => {
      transport.ingestBatch = vi.fn(async (_input) => {
        resolve();
        return new Promise<{
          ok: true;
          data: AnalyticsBatchIngestResponse;
        }>((release) => {
          releaseIngest = release;
        });
      });
    });

    const flushing = client.flush();
    await ingestStarted;
    const denying = client.setConsent("denied");
    releaseIngest({
      ok: true,
      data: {
        acceptedIds: events.slice(0, 50).map((event) => event.id),
        rejectedCount: 0,
      },
    });

    await Promise.all([flushing, denying]);
    expect(await client.getConsent()).toBe("denied");
    expect(await client.list()).toEqual([]);
  });

  it("resetLocalSession clears local state without issuing server consent revocation", async () => {
    const transport = createMockTransport();
    const consentFile = createMemoryFile();
    const queueFile = createMemoryFile();
    const client = new NetworkAnalyticsClient(
      transport,
      consentFile,
      queueFile,
      () => 1000000,
      "1.0.0",
    );

    await client.setConsent("granted");
    const consentCallsBefore = transport.consentCalls.length;

    await client.resetLocalSession();

    // No new server consent calls were made
    expect(transport.consentCalls.length).toBe(consentCallsBefore);
    // Local consent file was deleted
    expect(consentFile.exists).toBe(false);
    // Queue is empty
    expect(await client.list()).toHaveLength(0);
    // Consent is reset to unknown on new unauthenticated session
    expect(await client.getConsent()).toBe("unknown");
  });

  it("supports clearing events and exports data", async () => {
    const transport = createMockTransport();
    const consentFile = createMemoryFile();
    const queueFile = createMemoryFile();
    const client = new NetworkAnalyticsClient(
      transport,
      consentFile,
      queueFile,
      () => 1000000,
      "1.0.0",
    );

    await client.setConsent("granted");
    await client.track({
      name: "app_session_started",
      properties: { entryPoint: "cold_start" },
    });
    await client.flush();

    const exported = await client.export();
    expect(exported.schemaVersion).toBe(2);
    expect(exported.events).toHaveLength(1);
    expect(exported.events[0].name).toBe("app_session_started");

    const cleared = await client.clear();
    expect(cleared).toBe(true);
    expect(transport.clearCalls).toHaveLength(1);

    const exportedAfter = await client.export();
    expect(exportedAfter.events).toHaveLength(0);
  });
});
