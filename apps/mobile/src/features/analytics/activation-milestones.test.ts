import { describe, expect, it, vi } from "vitest";
import { analyticsEventV2Schema } from "@mizyun/contracts";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import {
  ActivationMilestones,
  calendarDaysBetween,
  clearActivationState,
  isoWeekOf,
  localIsoDate,
  type ActivationStore,
} from "./activation-milestones";
import type { AnalyticsEventInput } from "./network-analytics-client";

function memoryStore(): ActivationStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => void values.set(key, value),
    deleteItemAsync: async (key) => void values.delete(key),
  };
}

function harness(initiallyRecorded = true) {
  const store = memoryStore();
  const sent: AnalyticsEventInput[] = [];
  let now = new Date(2026, 9, 26, 9, 0);
  let recorded = initiallyRecorded;
  const track = vi.fn(async (event: AnalyticsEventInput) => {
    if (recorded) sent.push(event);
    return recorded
      ? ({ recorded: true } as const)
      : ({ recorded: false, reason: "consent_not_granted" } as const);
  });
  const milestones = new ActivationMilestones(store, { track }, () => now);
  return {
    store,
    sent,
    track,
    milestones,
    at(day: number, hour = 9) {
      now = new Date(2026, 9, 26 + day, hour, 0);
    },
    grantConsent() {
      recorded = true;
    },
  };
}

/** Wire-shape check: the strict contract rejects any extra property. */
const wire = (event: AnalyticsEventInput) =>
  analyticsEventV2Schema.safeParse({
    id: "00000000-0000-4000-8000-000000000001",
    schemaVersion: 2,
    recordedAt: "2026-10-26T09:00:00.000Z",
    sessionId: "00000000-0000-4000-8000-000000000002",
    sequence: 0,
    platform: "ios",
    appVersion: "1.0.11",
    name: event.name,
    properties: event.properties ?? {},
  }).success;

describe("activation milestones", () => {
  it("emits the first run, first confirmed record and both return windows once", async () => {
    const h = harness();
    await h.milestones.completeFirstRun("owner-a", "climb", Date.now());
    await h.milestones.recordCoreAction("owner-a", "bouldering_session");
    await h.milestones.recordCoreAction("owner-a", "meal");
    h.at(3);
    await h.milestones.recordCoreAction("owner-a", "workout");
    h.at(6);
    await h.milestones.recordCoreAction("owner-a", "workout");
    h.at(15);
    await h.milestones.recordCoreAction("owner-a", "meal");
    h.at(22);
    await h.milestones.recordCoreAction("owner-a", "body_measurement");
    h.at(28);
    await h.milestones.recordCoreAction("owner-a", "meal");

    expect(h.sent.map((event) => event.name)).toEqual([
      "first_run_completed",
      "first_confirmed_record",
      "return_milestone_reached",
      "return_milestone_reached",
    ]);
    expect(h.sent[1].properties).toEqual({ recordKind: "bouldering_session" });
    expect(h.sent.slice(2).map((event) => event.properties)).toEqual([
      { milestone: "day_7", cohortWeek: "2026-W44" },
      { milestone: "day_28", cohortWeek: "2026-W44" },
    ]);
    expect(h.sent.every(wire)).toBe(true);
  });

  it("does not count same-day actions or days 8-21 and 29+ as returns", async () => {
    const h = harness();
    await h.milestones.completeFirstRun("owner-a", "meal", Date.now());
    await h.milestones.recordCoreAction("owner-a", "meal");
    h.at(0, 23);
    await h.milestones.recordCoreAction("owner-a", "meal");
    for (const day of [8, 14, 21, 29, 40]) {
      h.at(day);
      await h.milestones.recordCoreAction("owner-a", "meal");
    }
    expect(h.sent.map((event) => event.name)).toEqual([
      "first_run_completed",
      "first_confirmed_record",
    ]);
  });

  it("anchors a first record made without a first-run choice", async () => {
    const h = harness();
    await h.milestones.completeFirstRun("owner-a", "workout", Date.now());
    await h.milestones.recordCoreAction("owner-b", "bouldering_session");
    await h.milestones.recordCoreAction(null, "workout");
    const state = await h.milestones.stateFor("owner-b");
    expect(state).toMatchObject({
      owner: "owner-b",
      choice: null,
      firstRecordOn: "2026-10-26",
    });
    // No first-run choice is invented; the record is the first one.
    expect(h.sent).toEqual([
      {
        name: "first_run_completed",
        properties: { choice: "workout", duration: "under_30_seconds" },
      },
      {
        name: "first_confirmed_record",
        properties: { recordKind: "bouldering_session" },
      },
    ]);
    expect(h.sent.every(wire)).toBe(true);
    // A later first-run card does not replace the anchor or its first record.
    await h.milestones.completeFirstRun("owner-b", "climb", Date.now());
    expect((await h.milestones.stateFor("owner-b"))?.choice).toBeNull();
    expect(h.sent).toHaveLength(2);
  });

  it("sends no return milestones from an anchor without a first-run choice", async () => {
    const h = harness();
    await h.milestones.recordCoreAction("owner-d", "meal");
    for (const day of [3, 6, 22, 28]) {
      h.at(day);
      await h.milestones.recordCoreAction("owner-d", "workout");
    }
    expect(h.sent.map((event) => event.name)).toEqual([
      "first_confirmed_record",
    ]);
  });

  it("stores a missing choice as a string older builds accept", async () => {
    const h = harness();
    await h.milestones.recordCoreAction("owner-e", "workout");
    const raw = JSON.parse(h.store.values.get("mizyun.activation.v1.owner-e")!);
    expect(raw.choice).toBe("none");
    // The pre-change parser required a string choice to treat it as present.
    expect(typeof raw.choice).toBe("string");
  });

  it("leaves an unreadable stored anchor untouched", async () => {
    const h = harness();
    h.store.values.set("mizyun.activation.v1.owner-f", '{"version":2}');
    await h.milestones.recordCoreAction("owner-f", "meal");
    expect(h.store.values.get("mizyun.activation.v1.owner-f")).toBe(
      '{"version":2}',
    );
    expect(h.sent).toEqual([]);
  });

  it("does not re-create an erased owner's anchor from a late record", async () => {
    const h = harness();
    await h.milestones.completeFirstRun("owner-g", "meal", Date.now());
    await clearActivationState("owner-g", h.store);
    await h.milestones.recordCoreAction("owner-g", "meal");
    expect(await h.milestones.stateFor("owner-g")).toBeNull();
    // A new first run after the erasure starts a fresh anchor.
    await h.milestones.completeFirstRun("owner-g", "climb", Date.now());
    await h.milestones.recordCoreAction("owner-g", "bouldering_session");
    expect((await h.milestones.stateFor("owner-g"))?.firstRecordOn).toBe(
      "2026-10-26",
    );
  });

  it("anchors a record made without consent and never replays it", async () => {
    const h = harness(false);
    await h.milestones.recordCoreAction("owner-c", "bouldering_session");
    expect(h.sent).toEqual([]);
    expect((await h.milestones.stateFor("owner-c"))?.firstRecordOn).toBe(
      "2026-10-26",
    );
    // A later opt-in sends nothing for the earlier record.
    h.grantConsent();
    await h.milestones.recordCoreAction("owner-c", "meal");
    h.at(3);
    await h.milestones.recordCoreAction("owner-c", "workout");
    expect(h.sent).toEqual([]);
  });

  it("keeps the first-run anchor but sends nothing without consent", async () => {
    const h = harness(false);
    await h.milestones.completeFirstRun("owner-a", "weight", Date.now());
    await h.milestones.recordCoreAction("owner-a", "body_measurement");
    expect(h.sent).toEqual([]);
    // A later consent must not relabel a later record as the first one.
    const state = await h.milestones.stateFor("owner-a");
    expect(state?.firstRecordOn).toBe("2026-10-26");
    expect(
      await h.milestones.recordAcquisitionSource("owner-a", "instagram"),
    ).toBe(false);
    expect((await h.milestones.stateFor("owner-a"))?.sourceAnswered).toBe(
      false,
    );
  });

  it("records the acquisition source once, as an enum only", async () => {
    const h = harness();
    await h.milestones.completeFirstRun("owner-a", "explore", Date.now());
    expect(
      await h.milestones.recordAcquisitionSource(
        "owner-a",
        "climbing_gym_or_club",
      ),
    ).toBe(true);
    expect(
      await h.milestones.recordAcquisitionSource("owner-a", "reddit"),
    ).toBe(false);
    // "Just look around" stays in the install cohort.
    expect(h.sent).toEqual([
      {
        name: "first_run_completed",
        properties: { choice: "explore", duration: "under_30_seconds" },
      },
      {
        name: "acquisition_source_selected",
        properties: { source: "climbing_gym_or_club" },
      },
    ]);
    expect(h.sent.every(wire)).toBe(true);
  });

  it("does not restart the first run for an existing anchor", async () => {
    const h = harness();
    await h.milestones.completeFirstRun("owner-a", "meal", Date.now());
    await h.milestones.completeFirstRun("owner-a", "climb", Date.now());
    expect((await h.milestones.stateFor("owner-a"))?.choice).toBe("meal");
    expect(h.sent).toHaveLength(1);
  });

  it("treats unreadable state as absent and never throws from a core action", async () => {
    const h = harness();
    h.store.values.set("mizyun.activation.v1.owner-a", "{not json");
    expect(await h.milestones.stateFor("owner-a")).toBeNull();
    const broken = new ActivationMilestones(
      {
        getItemAsync: async () => {
          throw new Error("locked");
        },
        setItemAsync: async () => undefined,
        deleteItemAsync: async () => undefined,
      },
      { track: h.track },
    );
    await expect(
      broken.recordCoreAction("owner-a", "meal"),
    ).resolves.toBeUndefined();
  });

  // Erasures are remembered per process, so these owners are used nowhere else.
  it("orders an erasure after a core action that already started", async () => {
    const h = harness();
    await h.milestones.completeFirstRun("erased-a", "meal", Date.now());
    const pending = h.milestones.recordCoreAction("erased-a", "meal");
    const erased = clearActivationState("erased-a", h.store);
    await Promise.all([pending, erased]);
    expect(h.store.values.size).toBe(0);
  });

  it("erases only the owner's anchor and rejects unsafe keys", async () => {
    const h = harness();
    await h.milestones.completeFirstRun("erased-a", "meal", Date.now());
    await clearActivationState("erased-b", h.store);
    expect(await h.milestones.stateFor("erased-a")).not.toBeNull();
    await clearActivationState("erased-a", h.store);
    expect(await h.milestones.stateFor("erased-a")).toBeNull();
    await expect(clearActivationState("../x", h.store)).rejects.toThrow();
  });
});

describe("calendar helpers", () => {
  it("counts local calendar days across a DST change", () => {
    expect(localIsoDate(new Date(2026, 2, 28, 23, 30))).toBe("2026-03-28");
    expect(calendarDaysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(calendarDaysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(calendarDaysBetween("2026-12-31", "2027-01-07")).toBe(7);
  });

  it("labels ISO weeks at year boundaries", () => {
    expect(isoWeekOf("2026-10-26")).toBe("2026-W44");
    expect(isoWeekOf("2027-01-01")).toBe("2026-W53");
    expect(isoWeekOf("2024-12-30")).toBe("2025-W01");
    expect(isoWeekOf("2026-01-01")).toBe("2026-W01");
  });
});
