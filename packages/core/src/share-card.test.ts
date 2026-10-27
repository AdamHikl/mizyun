import { describe, expect, it } from "vitest";

import {
  SHARE_CARD_FIELDS,
  SHARE_CARD_MAX_ROWS,
  boulderShareCard,
  shareCardDateLabel,
  shareCardDuration,
  shareCardGymName,
  workoutShareCard,
  type BoulderShareCardInput,
  type WorkoutShareCardInput,
} from "./share-card.js";

/** Values that must never reach a card, planted on every input. */
const FORBIDDEN = {
  foodEntries: [{ name: "SECRET_FOOD_Burrito", calories: 987 }],
  bodyWeightKg: 83.7,
  weightEntries: [{ weightKg: 83.7, note: "SECRET_WEIGHT" }],
  measurements: { waistCm: 91.3, note: "SECRET_MEASUREMENT" },
  photoUri: "file:///SECRET_PHOTO.jpg",
  photos: [{ uri: "file:///SECRET_BODY_PHOTO.jpg" }],
  notes: "SECRET_NOTES felt heavy at 83.7 kg",
  coachText: "SECRET_COACH eat 2000 kcal",
  workoutName: "SECRET_WORKOUT_NAME cut week",
  gymName: "SECRET_SESSION_GYM",
  handle: "secret_handle",
  startedAt: "2026-10-26T06:12:34.000Z",
  holdColour: "SECRET_HOLD_pink",
};
const SENTINELS = [
  "SECRET",
  "secret_handle",
  "83.7",
  "987",
  "91.3",
  "2000",
  "06:12",
  "file://",
];

const boulderInput = (extra: object = {}): BoulderShareCardInput =>
  ({
    activityDate: "2026-10-26",
    sends: 9,
    flashes: 3,
    topGrade: "6C+",
    grades: [
      { grade: "6A", gradeRank: 10, sends: 5, flashes: 2 },
      { grade: "6C+", gradeRank: 14, sends: 1, flashes: 0 },
      { grade: "6B", gradeRank: 12, sends: 3, flashes: 1 },
    ],
    ...extra,
  }) as BoulderShareCardInput;

const workoutInput = (
  extra: Partial<WorkoutShareCardInput> & object = {},
): WorkoutShareCardInput =>
  ({
    activityDate: "2026-10-26",
    durationSeconds: 3900,
    unitSystem: "metric",
    exercises: [
      {
        name: "Back Squat",
        notes: "SECRET_NOTES",
        sets: [
          { setType: "warmup", loadKg: 60, repetitions: 5 },
          { setType: "normal", loadKg: 100, repetitions: 5 },
          { setType: "normal", loadKg: 100, repetitions: 6 },
        ],
      },
      {
        name: "Pull-up",
        sets: [
          { setType: "normal", loadKg: null, repetitions: 8 },
          { setType: "normal", loadKg: null, repetitions: 7 },
        ],
      },
    ],
    ...extra,
  }) as WorkoutShareCardInput;

const allStrings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(allStrings)
      : value && typeof value === "object"
        ? Object.values(value).flatMap(allStrings)
        : typeof value === "number"
          ? [String(value)]
          : [];

const expectNoForbidden = (card: object) => {
  expect(Object.keys(card)).toEqual([...SHARE_CARD_FIELDS]);
  const text = JSON.stringify(card);
  for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
  for (const value of allStrings(card))
    for (const sentinel of SENTINELS) expect(value).not.toContain(sentinel);
};

describe("boulderShareCard", () => {
  it("shows the ADR-0067 fields, hardest grade first", () => {
    const card = boulderShareCard(boulderInput());
    expect(card.title).toBe("Bouldering session");
    expect(card.dateLabel).toBe("Oct 26, 2026");
    expect(card.stats.map((s) => [s.label, s.value])).toEqual([
      ["Top grade", "6C+"],
      ["Sends", "9"],
      ["Flashes", "3"],
    ]);
    expect(card.rows.map((r) => [r.label, r.value, r.fraction])).toEqual([
      ["6C+", "1", 0.2],
      ["6B", "3 · 1 flash", 0.6],
      ["6A", "5 · 2 flashes", 1],
    ]);
    expect(card.rows[0]?.highlight).toBe(true);
    expect(card.gymName).toBeNull();
    expect(card.handle).toBeNull();
    expect(card.accessibilityLabel).toContain("Top grade 6C plus");
    expect(card.accessibilityLabel).toMatch(/Made with Mizyun$/);
  });

  it("never copies extra input fields, including the session's own gym name", () => {
    expectNoForbidden(boulderShareCard(boulderInput(FORBIDDEN)));
    expectNoForbidden(
      boulderShareCard(boulderInput(FORBIDDEN), {
        handle: {
          communityMember: false,
          include: true,
          handle: "secret_handle",
        },
      }),
    );
  });

  it("handles a session with no sends", () => {
    const card = boulderShareCard(
      boulderInput({ sends: 0, flashes: 0, topGrade: null, grades: [] }),
    );
    expect(card.stats[0]).toMatchObject({ value: "—", spoken: "No top grade" });
    expect(card.rows).toEqual([]);
  });

  it("caps grade rows and counts the rest", () => {
    const grades = Array.from({ length: 9 }, (_, i) => ({
      grade: `G${i}`,
      gradeRank: i,
      sends: 1,
      flashes: 0,
    }));
    const card = boulderShareCard(boulderInput({ grades }));
    expect(card.rows).toHaveLength(SHARE_CARD_MAX_ROWS);
    expect(card.moreRows).toBe(3);
    expect(card.rows[0]?.label).toBe("G8");
  });
});

describe("workoutShareCard", () => {
  it("summarises working sets, volume, top sets and duration in kg", () => {
    const card = workoutShareCard(workoutInput());
    expect(card.title).toBe("Workout");
    expect(card.stats.map((s) => [s.label, s.value])).toEqual([
      ["Exercises", "2"],
      ["Sets", "4"],
      ["Volume", "1,100 kg"],
      ["Time", "1 h 05 min"],
    ]);
    expect(card.rows.map((r) => [r.label, r.value])).toEqual([
      ["Back Squat", "100 kg × 6"],
      ["Pull-up", "2 sets"],
    ]);
    expect(card.rows[0]?.spoken).toBe(
      "Back Squat: 2 sets, top set 100 kg for 6 reps",
    );
  });

  it("converts to pounds for imperial users", () => {
    const card = workoutShareCard(workoutInput({ unitSystem: "imperial" }));
    expect(card.stats.find((s) => s.label === "Volume")?.value).toBe(
      "2,425 lb",
    );
    expect(card.rows[0]?.value).toBe("220.5 lb × 6");
  });

  it("marks personal records only for exercises with a loaded top set", () => {
    const card = workoutShareCard(
      workoutInput({ personalRecords: ["back squat", "Pull-up"] }),
    );
    expect(card.rows.map((r) => [r.value, r.highlight])).toEqual([
      ["PR · 100 kg × 6", true],
      ["2 sets", false],
    ]);
    expect(card.rows[0]?.spoken).toMatch(/personal record$/);
  });

  it("never copies extra input fields such as body weight, food or notes", () => {
    expectNoForbidden(workoutShareCard(workoutInput(FORBIDDEN)));
    expectNoForbidden(
      workoutShareCard(workoutInput(FORBIDDEN), { gymName: "Boulderwelt" }),
    );
  });

  it("drops warm-up-only and unnamed exercises and omits zero volume", () => {
    const card = workoutShareCard(
      workoutInput({
        durationSeconds: 20,
        exercises: [
          {
            name: "Bench",
            sets: [{ setType: "warmup", loadKg: 40, repetitions: 10 }],
          },
          {
            name: "  ",
            sets: [{ setType: "normal", loadKg: 50, repetitions: 5 }],
          },
          {
            name: "Plank",
            sets: [{ setType: "normal", loadKg: null, repetitions: null }],
          },
        ],
      }),
    );
    expect(card.rows.map((r) => r.label)).toEqual(["Plank"]);
    expect(card.stats.map((s) => s.label)).toEqual(["Exercises", "Sets"]);
  });
});

describe("card options", () => {
  it("cleans a typed gym name and drops blank ones", () => {
    expect(shareCardGymName("  Boulder‮welt\n Ost ")).toBe("Boulder welt Ost");
    expect(shareCardGymName("   ")).toBeNull();
    expect(shareCardGymName(undefined)).toBeNull();
    expect(Array.from(shareCardGymName("x".repeat(80)) ?? "")).toHaveLength(40);
    expect(
      boulderShareCard(boulderInput(), { gymName: "Ostbloc" }).gymName,
    ).toBe("Ostbloc");
  });

  it("shows a handle only for a Community member who switched it on", () => {
    const withHandle = (
      communityMember: boolean,
      include: boolean,
      handle = "crimp_queen",
    ) =>
      boulderShareCard(boulderInput(), {
        handle: { communityMember, include, handle },
      }).handle;
    expect(withHandle(true, true)).toBe("@crimp_queen");
    expect(withHandle(true, false)).toBeNull();
    expect(withHandle(false, true)).toBeNull();
    expect(withHandle(true, true, "not a handle!")).toBeNull();
  });

  it("formats the calendar day without shifting it by time zone", () => {
    expect(shareCardDateLabel("2026-01-01")).toBe("Jan 1, 2026");
    expect(shareCardDateLabel("2026-01-01", "de")).toBe("1. Jan. 2026");
    expect(shareCardDateLabel("2026-10-26T23:00:00Z")).toBe("");
  });

  it("formats durations from one minute up", () => {
    expect(shareCardDuration(null)).toBeNull();
    expect(shareCardDuration(59)).toBeNull();
    expect(shareCardDuration(45 * 60)).toBe("45 min");
    expect(shareCardDuration(2 * 3600)).toBe("2 h 00 min");
  });
});
