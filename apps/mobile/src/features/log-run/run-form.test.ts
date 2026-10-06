import { describe, it, expect } from "vitest";
import { parseRunForm, formFromRun } from "./run-form";
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
