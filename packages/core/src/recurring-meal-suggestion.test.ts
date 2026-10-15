import { describe, expect, it } from "vitest";
import {
  detectRecurringMealSuggestion,
  recurringMealSuggestionIdentityKey,
  type RecurringMealSuggestionEntry,
  type RecurringMealSuggestionInput,
} from "./recurring-meal-suggestion";
const entry = (
  day: string,
  id: number,
  patch: Partial<RecurringMealSuggestionEntry> = {},
): RecurringMealSuggestionEntry => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  userId: "owner",
  name: "Yogurt 150 g",
  consumedAt: `${day}T08:05:00Z`,
  createdAt: `${day}T08:06:00Z`,
  updatedAt: `${day}T08:06:00Z`,
  confirmedByUser: true,
  caloriesKcal: 150,
  proteinG: 12,
  carbohydrateG: 15,
  fatG: 4,
  details: { grams: 150 },
  ...patch,
});
const entries = [
  entry("2026-10-11", 1),
  entry("2026-10-12", 2),
  entry("2026-10-13", 3),
];
const input = (
  patch: Partial<RecurringMealSuggestionInput> = {},
): RecurringMealSuggestionInput => ({
  userId: "owner",
  entries,
  generatedEntryIds: [],
  historyComplete: true,
  referenceAt: new Date("2026-10-13T09:00:00Z"),
  timeZone: "UTC",
  ...patch,
});
describe("meal routine suggestions", () => {
  it("proposes a reproducible daily schedule starting tomorrow after the third save", () => {
    const result = detectRecurringMealSuggestion(input())!;
    expect(result).toMatchObject({
      localTime: "08:00",
      startLocalDate: "2026-10-14",
      reasonCode: "three_consecutive_days",
      familyKey: "yogurt 150 g",
      sourceEntryId: entries[2]!.id,
    });
    expect(result.evidence).toHaveLength(3);
    expect(
      detectRecurringMealSuggestion(input({ entries: [...entries].reverse() })),
    ).toEqual(result);
  });
  it("requires three distinct consecutive dates and complete history", () => {
    expect(
      detectRecurringMealSuggestion(input({ entries: entries.slice(1) })),
    ).toBeNull();
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: [
            entry("2026-10-13", 1),
            entry("2026-10-13", 2),
            entry("2026-10-13", 3),
          ],
        }),
      ),
    ).toBeNull();
    expect(
      detectRecurringMealSuggestion(input({ historyComplete: false })),
    ).toBeNull();
  });
  it.each(["caloriesKcal", "proteinG", "carbohydrateG", "fatG", "grams"])(
    "rejects unsupported %s before producing a wire proposal",
    (field) => {
      const large = entries.map((e) =>
        field === "grams"
          ? { ...e, details: { grams: 20001 } }
          : { ...e, [field]: 20001 },
      );
      expect(
        detectRecurringMealSuggestion(input({ entries: large })),
      ).toBeNull();
      const boundary = large.map((e) =>
        field === "grams"
          ? { ...e, details: { grams: 20000 } }
          : { ...e, [field]: 20000 },
      );
      expect(
        detectRecurringMealSuggestion(input({ entries: boundary })),
      ).not.toBeNull();
    },
  );
  it.each([
    { name: "Breakfast" },
    { name: "Yogurt 150 g with honey" },
    { details: { grams: 100 } },
    { caloriesKcal: 151 },
    { proteinG: null },
    { confirmedByUser: false },
    { userId: "someone else" },
    { deletedAt: "2026-10-12T10:00:00Z" },
  ])("rejects nonmatching or ineligible evidence %j", (patch) => {
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: [entries[0]!, { ...entries[1]!, ...patch }, entries[2]!],
        }),
      ),
    ).toBeNull();
  });
  it("preserves null versus zero and canonical Unicode/name spacing and number identity", () => {
    expect(
      recurringMealSuggestionIdentityKey({
        ...entries[0]!,
        name: "  CAFé   bowl ",
        caloriesKcal: 150.0,
      }),
    ).toEqual(
      recurringMealSuggestionIdentityKey({
        ...entries[0]!,
        name: "cafe\u0301 bowl",
      }),
    );
    expect(
      recurringMealSuggestionIdentityKey({ ...entries[0]!, proteinG: null }),
    ).not.toEqual(
      recurringMealSuggestionIdentityKey({ ...entries[0]!, proteinG: 0 }),
    );
  });
  it("excludes generated records by ledger even after marker removal but counts deliberate copies", () => {
    expect(
      detectRecurringMealSuggestion(
        input({ generatedEntryIds: [entries[1]!.id] }),
      ),
    ).toBeNull();
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: [
            entries[0]!,
            {
              ...entries[1]!,
              details: { grams: 150, recurringMeal: { scheduleId: "x" } },
            },
            entries[2]!,
          ],
        }),
      ),
    ).toBeNull();
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: entries.map((e) => ({
            ...e,
            details: { grams: 150, copiedFromFoodEntryId: "old" },
          })),
        }),
      ),
    ).not.toBeNull();
  });
  it("rejects future consumption, stale/backfilled saves", () => {
    for (const patch of [
      { consumedAt: "2026-10-13T10:00:00Z" },
      { createdAt: "2026-10-14T08:06:00Z" },
      { createdAt: "2026-10-12T08:06:00Z" },
    ])
      expect(
        detectRecurringMealSuggestion(
          input({
            entries: [entries[0]!, entries[1]!, { ...entries[2]!, ...patch }],
          }),
        ),
      ).toBeNull();
  });
  it("accepts wide chains at the median time but rejects midnight-rounded ones", () => {
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: [
            { ...entries[0]!, consumedAt: "2026-10-11T06:00:00Z" },
            entries[1]!,
            entries[2]!,
          ],
        }),
      )?.localTime,
    ).toBe("08:00");
    const midnight = entries.map((e) => ({
      ...e,
      consumedAt: e.consumedAt.replace("08:05", "23:58"),
      createdAt: e.createdAt.replace("08:06", "23:59"),
      updatedAt: e.updatedAt.replace("08:06", "23:59"),
    }));
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: midnight,
          referenceAt: new Date("2026-10-13T23:59:30Z"),
        }),
      ),
    ).toBeNull();
  });
  it("chooses matching morning duplicates without blending dinner", () => {
    const result = detectRecurringMealSuggestion(
      input({
        entries: [
          ...entries,
          entry("2026-10-11", 4, { consumedAt: "2026-10-11T19:00:00Z" }),
          entry("2026-10-12", 5, { consumedAt: "2026-10-12T19:00:00Z" }),
        ],
      }),
    );
    expect(result?.evidence.map((e) => e.id)).toEqual(entries.map((e) => e.id));
  });
  it("uses historical named-zone offsets across DST", () => {
    const dst = [
      entry("2026-10-23", 1, { consumedAt: "2026-10-23T06:05:00Z" }),
      entry("2026-10-24", 2, { consumedAt: "2026-10-24T06:05:00Z" }),
      entry("2026-10-25", 3, {
        consumedAt: "2026-10-25T07:05:00Z",
        createdAt: "2026-10-25T07:06:00Z",
        updatedAt: "2026-10-25T07:06:00Z",
      }),
    ];
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: dst,
          timeZone: "Europe/Bratislava",
          referenceAt: new Date("2026-10-25T09:00:00Z"),
        }),
      )?.localTime,
    ).toBe("08:00");
  });
  it("suppresses paused equivalents, durable negative decisions and global preference", () => {
    expect(
      detectRecurringMealSuggestion(
        input({
          existingSchedules: [
            {
              identityKey: recurringMealSuggestionIdentityKey(entries[0]!),
              localTime: "08:00",
              timeZone: "UTC",
              weekdays: [0, 1, 2, 3, 4, 5, 6],
            },
          ],
        }),
      ),
    ).toBeNull();
    for (const decision of [
      { never: true },
      { accepted: true },
      { cooldownUntil: "2026-11-01T00:00:00Z" },
    ])
      expect(
        detectRecurringMealSuggestion(
          input({ decisions: [{ familyKey: "yogurt 150 g", ...decision }] }),
        ),
      ).toBeNull();
    expect(detectRecurringMealSuggestion(input({ enabled: false }))).toBeNull();
    expect(
      detectRecurringMealSuggestion(
        input({
          decisions: [
            { familyKey: "another meal", firstShownAt: "2026-10-12T09:00:00Z" },
          ],
        }),
      ),
    ).toBeNull();
  });
});

it("keeps explicit copies eligible after attachment updates but edits do not refresh old saves", () => {
  expect(
    detectRecurringMealSuggestion(
      input({
        entries: [
          entries[0]!,
          entries[1]!,
          {
            ...entries[2]!,
            updatedAt: "2026-10-13T08:07:00Z",
            details: { grams: 150, copiedFromFoodEntryId: "old" },
          },
        ],
      }),
    ),
  ).not.toBeNull();
  expect(
    detectRecurringMealSuggestion(
      input({
        entries: [
          entries[0]!,
          entries[1]!,
          {
            ...entries[2]!,
            createdAt: "2026-10-12T08:00:00Z",
            updatedAt: "2026-10-13T08:07:00Z",
          },
        ],
      }),
    ),
  ).toBeNull();
  expect(
    detectRecurringMealSuggestion(
      input({
        decisions: [
          {
            familyKey: "yogurt 150 g",
            expiresAt: "2026-09-01T08:00:00Z",
            firstShownAt: "2026-08-25T08:00:00Z",
          },
        ],
      }),
    )?.expiresAt,
  ).toBe("2026-10-20T08:06:00.000Z");
});

it("compacts thousands of duplicate copies and keeps the freshest eligible source", () => {
  const many = Array.from({ length: 4998 }, (_, i) =>
    entry(`2026-10-${11 + (i % 3)}`, i + 10),
  );
  const freshest = entry("2026-10-13", 99999, {
    createdAt: "2026-10-13T08:59:00Z",
    updatedAt: "2026-10-13T08:59:00Z",
  });
  const result = detectRecurringMealSuggestion(
    input({ entries: [...many, freshest] }),
  );
  expect(result?.sourceEntryId).toBe(freshest.id);
  expect(result?.localTime).toBe("08:00");
  expect(
    detectRecurringMealSuggestion(
      input({ entries: [freshest, ...many].reverse() }),
    ),
  ).toEqual(result);
  // Large-input budget test: ~1-2s alone, slower under the parallel gate.
}, 20_000);

it("fails closed when distinct minute combinations exceed the resource budget", () => {
  const diverse = Array.from({ length: 300 }, (_, i) => {
    const hour = String(6 + Math.floor((i % 100) / 60)).padStart(2, "0"),
      minute = String((i % 100) % 60).padStart(2, "0");
    return entry(`2026-10-${11 + Math.floor(i / 100)}`, i + 1000, {
      consumedAt: `2026-10-${11 + Math.floor(i / 100)}T${hour}:${minute}:00Z`,
    });
  });
  expect(detectRecurringMealSuggestion(input({ entries: diverse }))).toBeNull();
});

describe("copied meals saved at a different time of day", () => {
  const coffee = (day: string, id: number, time: string) =>
    entry(day, id, {
      name: "Coffee with milk",
      consumedAt: `${day}T${time}:00Z`,
      createdAt: `${day}T${time}:30Z`,
      updatedAt: `${day}T${time}:30Z`,
      caloriesKcal: 40,
      proteinG: 2,
      carbohydrateG: 3,
      fatG: 2,
      details: {},
    });
  it("suggests the usual time when today's copy was saved hours later", () => {
    const result = detectRecurringMealSuggestion(
      input({
        entries: [
          coffee("2026-10-09", 1, "07:55"),
          coffee("2026-10-10", 2, "08:10"),
          coffee("2026-10-11", 3, "08:00"),
          coffee("2026-10-12", 4, "08:05"),
          // Copied from yesterday in the afternoon: consumedAt is the copy time.
          coffee("2026-10-13", 5, "14:30"),
        ],
        referenceAt: new Date("2026-10-13T14:31:00Z"),
      }),
    );
    expect(result).toMatchObject({
      name: "Coffee with milk",
      localTime: "08:00",
      sourceEntryId: coffee("2026-10-13", 5, "14:30").id,
      startLocalDate: "2026-10-14",
    });
  });
  it("suggests the rounded median when every day was copied at a different time", () => {
    const result = detectRecurringMealSuggestion(
      input({
        entries: [
          coffee("2026-10-11", 1, "07:10"),
          coffee("2026-10-12", 2, "12:40"),
          coffee("2026-10-13", 3, "18:20"),
        ],
        referenceAt: new Date("2026-10-13T18:21:00Z"),
      }),
    );
    expect(result?.localTime).toBe("12:45");
  });
  it("still prefers the tightest matching chain", () => {
    const result = detectRecurringMealSuggestion(
      input({
        entries: [
          coffee("2026-10-11", 1, "08:00"),
          coffee("2026-10-11", 2, "16:00"),
          coffee("2026-10-12", 3, "08:05"),
          coffee("2026-10-12", 4, "16:10"),
          coffee("2026-10-13", 5, "16:05"),
        ],
        referenceAt: new Date("2026-10-13T16:06:00Z"),
      }),
    );
    expect(result?.evidence.map((e) => e.id)).toEqual(
      [2, 4, 5].map((id) => coffee("2026-10-11", id, "00:00").id),
    );
    expect(result?.localTime).toBe("16:00");
  });
});

describe("weekly patterns over the last two weeks", () => {
  // 2026-10-19 is a Monday; weekdays use 0 = Sunday like Date#getUTCDay and PostgreSQL dow.
  const oats = (day: string, id: number, time = "07:45") =>
    entry(day, id, {
      name: "Oats",
      consumedAt: `${day}T${time}:00Z`,
      createdAt: `${day}T${time}:30Z`,
      updatedAt: `${day}T${time}:30Z`,
    });
  const at = (day: string, time = "09:00") => new Date(`${day}T${time}:00Z`);
  const days = (...list: string[]) => list.map((day, i) => oats(day, i + 1));
  const monToFri = days(
    "2026-10-06",
    "2026-10-07",
    "2026-10-08",
    "2026-10-09",
    "2026-10-12",
    "2026-10-13",
    "2026-10-14",
    "2026-10-15",
    "2026-10-16",
    "2026-10-19",
  );
  it("proposes Mon–Fri on Monday after two working weeks", () => {
    const result = detectRecurringMealSuggestion(
      input({ entries: monToFri, referenceAt: at("2026-10-19") }),
    )!;
    expect(result).toMatchObject({
      reasonCode: "weekly_pattern",
      policyVersion: "mrs-weekly-2w-v1",
      weekdays: [1, 2, 3, 4, 5],
      localTime: "07:45",
      startLocalDate: "2026-10-20",
      sourceEntryId: monToFri.at(-1)!.id,
      sourceUpdatedAt: monToFri.at(-1)!.updatedAt,
    });
    expect(result.evidence.map((e) => e.localDate)).toEqual(
      monToFri.map((e) => e.consumedAt.slice(0, 10)),
    );
    expect(result.candidateId).toMatch(/^mrs1-[0-9a-f]{8}$/);
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: [...monToFri].reverse(),
          referenceAt: at("2026-10-19"),
        }),
      ),
    ).toEqual(result);
  });
  const mwf = days(
    "2026-10-05",
    "2026-10-07",
    "2026-10-09",
    "2026-10-12",
    "2026-10-14",
    "2026-10-16",
  );
  it("proposes Mon/Wed/Fri shakes", () => {
    expect(
      detectRecurringMealSuggestion(
        input({ entries: mwf, referenceAt: at("2026-10-16") }),
      ),
    ).toMatchObject({ weekdays: [1, 3, 5], startLocalDate: "2026-10-17" });
  });
  it("drops a weekday seen only once and needs at least two weekdays including today", () => {
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: mwf.filter((e) => !e.consumedAt.startsWith("2026-10-07")),
          referenceAt: at("2026-10-16"),
        }),
      )?.weekdays,
    ).toEqual([1, 5]);
    // Only Friday repeats: |W| = 1.
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: days("2026-10-07", "2026-10-09", "2026-10-16"),
          referenceAt: at("2026-10-16"),
        }),
      ),
    ).toBeNull();
    // Mon/Wed repeat but today's Friday occurred once: today is not in W.
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: mwf.filter((e) => !e.consumedAt.startsWith("2026-10-09")),
          referenceAt: at("2026-10-16"),
        }),
      ),
    ).toBeNull();
    // Entries outside the 14-day window never pair.
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: days(
            "2026-10-02",
            "2026-10-07",
            "2026-10-09",
            "2026-10-14",
            "2026-10-16",
          ),
          referenceAt: at("2026-10-23"),
        }),
      ),
    ).toBeNull();
  });
  it("keeps daily priority with byte-identical daily proposals when a weekday was seen once", () => {
    const result = detectRecurringMealSuggestion(
      input({ entries: monToFri.slice(0, 7), referenceAt: at("2026-10-14") }),
    )!;
    expect(result).toMatchObject({
      reasonCode: "three_consecutive_days",
      policyVersion: "mrs-exact-3-v1",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    expect(result.evidence).toHaveLength(3);
    // Seven weekdays in both weeks is daily territory, never weekly.
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: Array.from({ length: 14 }, (_, i) =>
            oats(`2026-10-${String(6 + i).padStart(2, "0")}`, i + 1),
          ),
          referenceAt: at("2026-10-19"),
        }),
      )?.reasonCode,
    ).toBe("three_consecutive_days");
  });
  it("prefers a clean two-week Mon–Fri rhythm over the three-day daily chain", () => {
    // Wednesday 2026-10-14: window 10-01 (Thu) … 10-14; weekends empty in both weeks.
    const clean = days(
      "2026-10-01",
      "2026-10-02",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
    );
    const result = detectRecurringMealSuggestion(
      input({ entries: clean, referenceAt: at("2026-10-14") }),
    );
    expect(result).toMatchObject({
      reasonCode: "weekly_pattern",
      weekdays: [1, 2, 3, 4, 5],
    });
    expect(result?.evidence).toHaveLength(10);
    // An unaccepted daily offer already shown for the family does not block it.
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: clean,
          referenceAt: at("2026-10-14"),
          decisions: [
            {
              familyKey: "oats",
              firstShownAt: "2026-10-13T09:00:00.000Z",
              expiresAt: "2026-10-20T09:00:00.000Z",
            },
          ],
        }),
      ),
    ).toMatchObject({
      reasonCode: "weekly_pattern",
      expiresAt: "2026-10-20T09:00:00.000Z",
    });
  });
  it("keeps daily for a daily logger who missed one day last week, and for fourteen straight days", () => {
    const allDays = Array.from({ length: 14 }, (_, i) =>
      oats(`2026-10-${String(6 + i).padStart(2, "0")}`, i + 1),
    );
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: allDays.filter(
            (e) => !e.consumedAt.startsWith("2026-10-09"),
          ),
          referenceAt: at("2026-10-19"),
        }),
      )?.reasonCode,
    ).toBe("three_consecutive_days");
    expect(
      detectRecurringMealSuggestion(
        input({ entries: allDays, referenceAt: at("2026-10-19") }),
      )?.reasonCode,
    ).toBe("three_consecutive_days");
  });
  it("uses the lower median for an even number of evidence times", () => {
    const result = detectRecurringMealSuggestion(
      input({
        entries: [
          oats("2026-10-07", 1, "07:00"),
          oats("2026-10-09", 2, "07:30"),
          oats("2026-10-14", 3, "08:00"),
          oats("2026-10-16", 4, "08:30"),
        ],
        referenceAt: at("2026-10-16"),
      }),
    );
    expect(result?.weekdays).toEqual([3, 5]);
    expect(result?.localTime).toBe("07:30");
  });
  it("uses named-zone dates and offsets across DST", () => {
    // Europe/Bratislava leaves summer time on 2026-10-25: 08:05 local is 06:05Z, then 07:05Z.
    const local = (day: string, id: number, utc: string) =>
      entry(day, id, {
        name: "Oats",
        consumedAt: `${day}T${utc}:00Z`,
        createdAt: `${day}T${utc}:30Z`,
        updatedAt: `${day}T${utc}:30Z`,
      });
    const result = detectRecurringMealSuggestion(
      input({
        entries: [
          local("2026-10-14", 1, "06:05"),
          local("2026-10-19", 2, "06:05"),
          local("2026-10-21", 3, "06:05"),
          local("2026-10-26", 4, "07:05"),
        ],
        timeZone: "Europe/Bratislava",
        referenceAt: at("2026-10-26"),
      }),
    );
    expect(result).toMatchObject({ weekdays: [1, 3], localTime: "08:00" });
    // A Monday 22:30Z save is Tuesday 00:30 in Bratislava, so Monday occurs once.
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: [
            local("2026-10-14", 1, "06:05"),
            local("2026-10-19", 2, "22:30"),
            local("2026-10-21", 3, "06:05"),
            local("2026-10-26", 4, "07:05"),
          ],
          timeZone: "Europe/Bratislava",
          referenceAt: at("2026-10-26"),
        }),
      ),
    ).toBeNull();
  });
  it("suppresses an active schedule covering the same weekdays and identity", () => {
    const identityKey = recurringMealSuggestionIdentityKey(mwf[0]!);
    for (const weekdays of [
      [1, 3, 5],
      [0, 1, 2, 3, 4, 5, 6],
    ])
      expect(
        detectRecurringMealSuggestion(
          input({
            entries: mwf,
            referenceAt: at("2026-10-16"),
            existingSchedules: [
              { identityKey, localTime: "06:30", timeZone: "UTC", weekdays },
            ],
          }),
        ),
      ).toBeNull();
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: mwf,
          referenceAt: at("2026-10-16"),
          existingSchedules: [
            { identityKey, localTime: "07:45", timeZone: "UTC", weekdays: [1] },
          ],
        }),
      ),
    ).not.toBeNull();
  });
  it("fails closed when the weekly search exceeds the resource budget", () => {
    const minutes = (day: string, base: number, count: number) =>
      Array.from({ length: count }, (_, i) => {
        const m = 300 + i;
        const time = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        return oats(day, base + i, time);
      });
    const fresh = (count: number) =>
      minutes("2026-10-16", 50_000, count).map((e) => ({
        ...e,
        createdAt: "2026-10-16T20:00:00Z",
        updatedAt: "2026-10-16T20:00:00Z",
      }));
    const history = (count: number) => [
      ...minutes("2026-10-07", 10_000, count),
      ...minutes("2026-10-09", 20_000, count),
      ...minutes("2026-10-14", 30_000, count),
    ];
    const ref = at("2026-10-16", "21:00");
    expect(
      detectRecurringMealSuggestion(
        input({ entries: [...history(20), ...fresh(20)], referenceAt: ref }),
      )?.reasonCode,
    ).toBe("weekly_pattern");
    expect(
      detectRecurringMealSuggestion(
        input({ entries: [...history(500), ...fresh(500)], referenceAt: ref }),
      ),
    ).toBeNull();
    // An over-budget weekly search keeps an available daily proposal.
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: [
            ...history(500),
            ...fresh(500),
            oats("2026-10-15", 90_000, "05:00"),
          ],
          referenceAt: ref,
        }),
      )?.reasonCode,
    ).toBe("three_consecutive_days");
    // Large-input budget test: ~1-2s alone, slower under the parallel gate.
  }, 20_000);
});
