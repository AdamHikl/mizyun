import { describe, expect, it } from "vitest";
import { rankMealQuickAdd, type MealQuickAddEntry } from "./meal-quick-add";

let n = 0;
const e = (
  name: string,
  consumedAt: string,
  patch: Partial<MealQuickAddEntry> = {},
): MealQuickAddEntry => ({
  id: `id-${String(++n).padStart(4, "0")}`,
  name,
  consumedAt,
  confirmedByUser: true,
  details: {},
  ...patch,
});
const names = (r: { entry: MealQuickAddEntry }[]) => r.map((s) => s.entry.name);
const days = (list: readonly string[], time: string, name: string) =>
  list.map((d) => e(name, `${d}T${time}:00Z`));

describe("rankMealQuickAdd", () => {
  const ref = new Date("2026-10-15T08:30:00Z");
  const base = { referenceAt: ref, timeZone: "UTC", limit: 6 };

  it("ranks a frequent habit above a one-off more recent meal", () => {
    const entries = [
      ...days(
        ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"],
        "12:00",
        "Salad",
      ),
      e("Pizza", "2026-10-14T12:30:00Z"),
    ];
    expect(names(rankMealQuickAdd({ ...base, entries }))).toEqual([
      "Salad",
      "Pizza",
    ]);
  });

  it("boosts the item usually eaten at this time of day", () => {
    const coffee = days(
      ["2026-10-10", "2026-10-11", "2026-10-12"],
      "08:00",
      "Coffee",
    );
    const dinner = days(
      ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"],
      "19:00",
      "Dinner pasta",
    );
    const entries = [...dinner, ...coffee];
    const morning = rankMealQuickAdd({ ...base, entries });
    expect(morning[0]!.entry.name).toBe("Coffee");
    expect(morning[0]!.reason).toBe("usual_now");
    const evening = rankMealQuickAdd({
      ...base,
      referenceAt: new Date("2026-10-15T19:00:00Z"),
      entries,
    });
    expect(evening[0]!.entry.name).toBe("Dinner pasta");
    expect(evening[0]!.reason).toBe("usual_now");
  });

  it("groups by name and reuses the most recent variant", () => {
    const old = e("Oatmeal", "2026-10-10T08:00:00Z", { id: "a" });
    const recent = e("  oatmeal ", "2026-10-13T08:00:00Z", { id: "b" });
    const r = rankMealQuickAdd({
      ...base,
      entries: [old, recent, e("Eggs", "2026-10-12T08:00:00Z")],
    });
    expect(r).toHaveLength(2);
    expect(r[0]!.entry.id).toBe("b");
    expect(r[0]!.count).toBe(2);
    expect(r[0]!.reason).toBe("usual_now");
  });

  it("excludes recurring, deleted, unconfirmed, stale, future and invalid entries", () => {
    const entries = [
      e("Auto", "2026-10-14T08:00:00Z", { details: { recurringMeal: {} } }),
      e("Gone", "2026-10-14T08:00:00Z", { deletedAt: "2026-10-14T09:00:00Z" }),
      e("Draft", "2026-10-14T08:00:00Z", { confirmedByUser: false }),
      e("Ancient", "2026-08-01T08:00:00Z"),
      e("Future", "2026-10-16T08:00:00Z"),
      e("Broken", "not-a-date"),
      e("   ", "2026-10-14T08:00:00Z"),
      e("Kept", "2026-10-14T08:00:00Z"),
    ];
    expect(names(rankMealQuickAdd({ ...base, entries }))).toEqual(["Kept"]);
  });

  it("labels single entries recent and repeats frequent", () => {
    const r = rankMealQuickAdd({
      ...base,
      entries: [
        e("One", "2026-10-14T20:00:00Z"),
        ...days(["2026-10-12", "2026-10-13"], "20:00", "Twice"),
      ],
    });
    expect(Object.fromEntries(r.map((s) => [s.entry.name, s.reason]))).toEqual({
      One: "recent",
      Twice: "frequent",
    });
  });

  it("breaks ties deterministically regardless of input order", () => {
    const a = e("Alpha", "2026-10-14T08:00:00Z", { id: "1" });
    const b = e("Beta", "2026-10-14T08:00:00Z", { id: "2" });
    const one = rankMealQuickAdd({ ...base, entries: [a, b] });
    const two = rankMealQuickAdd({ ...base, entries: [b, a] });
    expect(names(one)).toEqual(["Alpha", "Beta"]);
    expect(names(two)).toEqual(["Alpha", "Beta"]);
  });

  it("respects the limit and handles empty or non-positive limits", () => {
    const entries = ["A", "B", "C"].map((x) => e(x, "2026-10-14T08:00:00Z"));
    expect(rankMealQuickAdd({ ...base, entries, limit: 2 })).toHaveLength(2);
    expect(rankMealQuickAdd({ ...base, entries, limit: 0 })).toEqual([]);
    expect(rankMealQuickAdd({ ...base, entries: [] })).toEqual([]);
  });

  it("measures time of day in the local zone, circularly across midnight", () => {
    // 07:00Z is 09:00 in Berlin (CEST); the user is at 09:10 Berlin.
    const entries = [
      ...days(["2026-10-12", "2026-10-13"], "07:00", "Berlin breakfast"),
      ...days(["2026-10-12", "2026-10-13"], "16:00", "Berlin tea"),
    ];
    const r = rankMealQuickAdd({
      ...base,
      timeZone: "Europe/Berlin",
      referenceAt: new Date("2026-10-15T07:10:00Z"),
      entries,
    });
    expect(r[0]!.entry.name).toBe("Berlin breakfast");
    // 23:50 and 00:10 local are 20 minutes apart.
    const late = rankMealQuickAdd({
      ...base,
      referenceAt: new Date("2026-10-15T00:10:00Z"),
      entries: [
        ...days(["2026-10-12", "2026-10-13"], "23:50", "Night"),
        ...days(["2026-10-12", "2026-10-13"], "12:00", "Noon"),
      ],
    });
    expect(late[0]!.entry.name).toBe("Night");
    expect(late[0]!.reason).toBe("usual_now");
  });

  it("stays correct across a DST change and with an invalid zone", () => {
    // Europe/Berlin leaves DST on 2026-10-25: 08:00 local is 06:00Z before, 07:00Z after.
    const entries = [
      e("Toast", "2026-10-22T06:00:00Z"),
      e("Toast", "2026-10-23T06:00:00Z"),
      e("Late lunch", "2026-10-22T11:00:00Z"),
      e("Late lunch", "2026-10-23T11:00:00Z"),
    ];
    const r = rankMealQuickAdd({
      ...base,
      timeZone: "Europe/Berlin",
      referenceAt: new Date("2026-10-26T07:05:00Z"),
      entries: entries.map((x) => ({ ...x })),
    });
    // Reference is 08:05 local (CET); Toast was 08:00 local (CEST) -> usual now.
    expect(r[0]!.entry.name).toBe("Toast");
    const bad = rankMealQuickAdd({
      ...base,
      timeZone: "Not/AZone",
      referenceAt: new Date("2026-10-26T07:05:00Z"),
      entries,
    });
    expect(bad.length).toBeGreaterThan(0);
  });
});
