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
  it("rejects wide and date-crossing rounded time chains", () => {
    expect(
      detectRecurringMealSuggestion(
        input({
          entries: [
            { ...entries[0]!, consumedAt: "2026-10-11T06:00:00Z" },
            entries[1]!,
            entries[2]!,
          ],
        }),
      ),
    ).toBeNull();
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
});

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
