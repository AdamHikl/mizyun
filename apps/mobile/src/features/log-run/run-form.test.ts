import { describe, it, expect } from "vitest";
import {
  parseRunForm,
  formFromRun,
  distancePatch,
  newRunTimeZone,
  quickDistances,
} from "./run-form";
import type { RunForm } from "./run-draft";
const form: RunForm = {
  activityDate: "2026-10-01",
  recordingTimezone: "Europe/Bratislava",
  minutes: "90",
  seconds: "30",
  distance: "",
  unit: "km",
  environment: "unspecified",
  effort: "",
  notes: "",
};
const id = "11111111-1111-4111-8111-111111111111";
describe("completed run form", () => {
  it("accepts duration-only and minutes over 59", () => {
    const result = parseRunForm(form, id);
    expect(result).toMatchObject({
      ok: true,
      body: { durationSeconds: 5430, distanceMeters: null, startedAt: null },
    });
  });
  it.each([
    { minutes: "", seconds: "" },
    { minutes: "25", seconds: "60" },
    { minutes: "1.5", seconds: "0" },
    { minutes: "-1", seconds: "0" },
  ])("rejects invalid elapsed duration %j", (patch) =>
    expect(parseRunForm({ ...form, ...patch }, id).ok).toBe(false),
  );
  it("supports locale decimal commas and canonical miles", () =>
    expect(
      parseRunForm({ ...form, distance: "3,1", unit: "mi" }, id),
    ).toMatchObject({ ok: true, body: { distanceMeters: 4988.97 } }));
  it("rejects distance zero and future completed dates", () => {
    expect(parseRunForm({ ...form, distance: "0" }, id).ok).toBe(false);
    expect(parseRunForm({ ...form, activityDate: "2099-01-01" }, id).ok).toBe(
      false,
    );
  });
});

describe("existing run edit fidelity", () => {
  const run = {
    name: "Morning run",
    notes: null,
    summary: {
      activityDate: "2026-10-01",
      recordingTimezone: "Europe/Bratislava",
      startedAt: "2026-10-01T07:30:00Z",
      durationSeconds: 1500,
      distanceMeters: 100.01,
      environment: "outdoor",
      perceivedExertion: null,
      origin: { kind: "manual" },
    },
  } as unknown as import("@mizyun/contracts").RunRecord;
  it("keeps observed start precision and name for a notes-only edit", () =>
    expect(
      parseRunForm({ ...formFromRun(run, "mi"), notes: "New note" }, id),
    ).toMatchObject({
      ok: true,
      body: {
        startedAt: run.summary.startedAt,
        name: "Morning run",
        distanceMeters: 100.01,
        notes: "New note",
      },
    }));
  it("keeps canonical centimetres despite a shortened miles field", () => {
    const f = formFromRun(run, "mi");
    expect(f.distance).toBe("0.06214");
    expect(parseRunForm(f, id)).toMatchObject({
      ok: true,
      body: { distanceMeters: 100.01 },
    });
  });
  it("rejects date changes for observed starts instead of silently changing precision", () =>
    expect(
      parseRunForm(
        { ...formFromRun(run, "km"), activityDate: "2026-09-30" },
        id,
      ).ok,
    ).toBe(false));
  it("accepts an explicitly edited distance instead of restoring stale canonical distance", () =>
    expect(
      parseRunForm({ ...formFromRun(run, "mi"), distance: "1" }, id),
    ).toMatchObject({ ok: true, body: { distanceMeters: 1609.34 } }));
});

describe("quick distances", () => {
  it.each(["km", "mi"] as const)(
    "submits exact half marathon metres in %s",
    (unit) => {
      const half = quickDistances.find((q) => q.label === "Half")!;
      const patch = distancePatch(half.meters, unit);
      expect(patch.distanceCanonicalUnit).toBe(unit);
      expect(patch.distance).toBe(unit === "km" ? "21.1" : "13.11");
      expect(parseRunForm({ ...form, ...patch }, id)).toMatchObject({
        ok: true,
        body: { distanceMeters: 21097.5 },
      });
    },
  );
});
describe("imported run edits", () => {
  const imported = {
    name: "Run",
    notes: null,
    summary: {
      activityDate: "2026-10-15",
      recordingTimezone: "Europe/Bratislava",
      startedAt: "2026-10-15T05:00:00Z",
      durationSeconds: 1800,
      durationBasis: "active",
      distanceMeters: 5012.35,
      environment: "outdoor",
      perceivedExertion: null,
      origin: {
        kind: "health_import",
        provider: "apple_health",
        sourceAppId: "com.example.watch",
        sourceAppName: null,
        externalId: "hk-1",
      },
    },
  } as unknown as import("@mizyun/contracts").RunRecord;
  it("locks provider metrics and resubmits them unchanged", () => {
    const form = formFromRun(imported, "mi");
    expect(form.metricsLocked).toBe(true);
    expect(parseRunForm({ ...form, notes: "Easy" }, id)).toMatchObject({
      ok: true,
      body: {
        startedAt: "2026-10-15T05:00:00Z",
        durationSeconds: 1800,
        distanceMeters: 5012.35,
        notes: "Easy",
      },
    });
  });
  it("locks file-imported metrics exactly like Health imports", () => {
    const fileRun = {
      ...imported,
      summary: {
        ...imported.summary,
        origin: { kind: "file_import", format: "strava", externalId: "123" },
      },
    } as unknown as typeof imported;
    const form = formFromRun(fileRun, "km");
    expect(form.metricsLocked).toBe(true);
    expect(parseRunForm({ ...form, notes: "Easy" }, id)).toMatchObject({
      ok: true,
      body: { startedAt: "2026-10-15T05:00:00Z", durationSeconds: 1800 },
    });
  });
  it("leaves manual runs editable", () =>
    expect(
      formFromRun(
        {
          ...imported,
          summary: { ...imported.summary, origin: { kind: "manual" } },
        } as typeof imported,
        "km",
      ).metricsLocked,
    ).toBeUndefined());
});

describe("newRunTimeZone (REL-01)", () => {
  it("uses the device zone while the profile still has the UTC default", () => {
    expect(newRunTimeZone("UTC", "America/Los_Angeles")).toBe(
      "America/Los_Angeles",
    );
    expect(newRunTimeZone(undefined, "America/Los_Angeles")).toBe(
      "America/Los_Angeles",
    );
  });

  it("keeps a saved profile zone", () => {
    expect(newRunTimeZone("Europe/Bratislava", "America/Los_Angeles")).toBe(
      "Europe/Bratislava",
    );
  });

  it("falls back to UTC without a usable device zone", () => {
    expect(newRunTimeZone("UTC", null)).toBe("UTC");
    expect(newRunTimeZone(null, "Not/AZone")).toBe("UTC");
  });
});
