import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Image: "Image", Text: "Text", View: "View" }));

import {
  boulderShareCard,
  workoutShareCard,
  type ShareCardContent,
} from "@mizyun/core";
import type { Workout, WorkoutSet } from "@mizyun/contracts";

import { SHARE_CARD_PALETTES, ShareCardView } from "./share-card-view";

/** Flattens a host-element tree (no renderer needed). */
const strip = (node: any): any => {
  if (Array.isArray(node)) return node.map(strip).filter((n) => n !== null);
  if (node === null || node === undefined || node === false) return null;
  if (typeof node !== "object") return node;
  if (typeof node.type === "function") return strip(node.type(node.props));
  const { children, ...props } = node.props ?? {};
  return { type: node.type, props, children: strip(children ?? null) };
};

const texts = (node: any): string[] => {
  if (Array.isArray(node)) return node.flatMap(texts);
  if (node === null || typeof node !== "object") return [];
  if (node.type === "Text") return [[node.children].flat(Infinity).join("")];
  return texts(node.children);
};

const strings = (node: any): string[] => {
  if (typeof node === "string" || typeof node === "number")
    return [String(node)];
  if (Array.isArray(node)) return node.flatMap(strings);
  if (node && typeof node === "object")
    return Object.values(node).flatMap(strings);
  return [];
};

const render = (content: ShareCardContent, scheme: "light" | "dark") =>
  strip(ShareCardView({ content, scheme, mark: { uri: "mark" } }));

const set = (
  id: string,
  loadKg: number | null,
  repetitions: number | null,
  setType: WorkoutSet["setType"] = "normal",
): Partial<WorkoutSet> & { notes: string } => ({
  id,
  setType,
  loadKg,
  repetitions,
  // Not a set field; planted to prove extra input never renders.
  notes: "SECRET_SET_NOTE body weight 84.2 kg",
});

const WORKOUT = {
  activityDate: "2026-10-26",
  durationSeconds: 3600 + 7 * 60,
  exercises: [
    {
      name: "Back Squat",
      sets: [set("1", 60, 5, "warmup"), set("2", 100, 5), set("3", 102.5, 3)],
    },
    { name: "Romanian Deadlift", sets: [set("4", 80, 8), set("5", 80, 8)] },
    { name: "Pull-up", sets: [set("6", null, 8), set("7", null, 6)] },
  ],
} as const;

const workoutCard = (unitSystem: "metric" | "imperial") =>
  workoutShareCard(
    { ...(WORKOUT as any), unitSystem, personalRecords: ["Back Squat"] },
    {
      gymName: "Ostbloc",
      handle: { communityMember: true, include: true, handle: "crimp_queen" },
    },
  );

const boulderCard = () =>
  boulderShareCard({
    activityDate: "2026-10-25",
    sends: 7,
    flashes: 2,
    topGrade: "6B+",
    grades: [
      { grade: "6B+", gradeRank: 13, sends: 1, flashes: 0 },
      { grade: "6A", gradeRank: 10, sends: 4, flashes: 2 },
      { grade: "5C", gradeRank: 8, sends: 2, flashes: 0 },
    ],
  });

describe("ShareCardView snapshots", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const unitSystem of ["metric", "imperial"] as const) {
      it(`workout card, ${scheme}, ${unitSystem}`, () => {
        const tree = render(workoutCard(unitSystem), scheme);
        expect(tree).toMatchSnapshot();
        expect(tree.props.style.backgroundColor).toBe(
          SHARE_CARD_PALETTES[scheme].background,
        );
      });
    }
    it(`bouldering card, ${scheme}`, () => {
      expect(render(boulderCard(), scheme)).toMatchSnapshot();
    });
  }

  it("shows the unit the user chose", () => {
    expect(texts(render(workoutCard("metric"), "light"))).toEqual(
      expect.arrayContaining(["2,088 kg", "PR · 102.5 kg × 3", "80 kg × 8"]),
    );
    expect(texts(render(workoutCard("imperial"), "light"))).toEqual(
      expect.arrayContaining(["4,602 lb", "PR · 226 lb × 3", "176.4 lb × 8"]),
    );
  });

  it("is one accessible image with a spoken summary", () => {
    const tree = render(boulderCard(), "dark");
    expect(tree.props).toMatchObject({
      accessible: true,
      accessibilityRole: "image",
      collapsable: false,
    });
    expect(tree.props.accessibilityLabel).toBe(
      "Bouldering session. Oct 25, 2026. Top grade 6B plus. 7 sends. 2 flashes. 6B plus: 1 send. 6A: 4 sends, 2 flashes. 5C: 2 sends. Made with Mizyun",
    );
  });

  it("scales to a narrower preview without changing its content", () => {
    const content = boulderCard();
    const full = strip(
      ShareCardView({ content, scheme: "light", mark: { uri: "m" } }),
    );
    const narrow = strip(
      ShareCardView({
        content,
        scheme: "light",
        width: 288,
        mark: { uri: "m" },
      }),
    );
    expect(texts(narrow)).toEqual(texts(full));
    expect(narrow.props.style).toMatchObject({ width: 288, height: 360 });
  });
});

describe("rendered card privacy", () => {
  it("contains no food, weight, measurement, photo, note or coach field", () => {
    const leaky = {
      ...WORKOUT,
      unitSystem: "metric",
      workout: {
        name: "SECRET_NAME cut",
        notes: "SECRET_NOTES 84.2 kg",
      } as Partial<Workout>,
      foodEntries: [{ description: "SECRET_FOOD oats", calories: 412 }],
      weightEntries: [{ weightKg: 84.2 }],
      bodyMeasurements: { waistCm: 88.8 },
      progressPhotos: ["file:///SECRET_PHOTO.jpg"],
      coachMessages: ["SECRET_COACH more protein"],
      exercises: WORKOUT.exercises.map((exercise) => ({
        ...exercise,
        notes: "SECRET_EXERCISE_NOTE",
        photoUri: "file:///SECRET_EX_PHOTO.jpg",
      })),
    };
    const trees = [
      render(workoutShareCard(leaky as any), "light"),
      render(
        workoutShareCard(leaky as any, {
          handle: { communityMember: false, include: true, handle: "lurker" },
        }),
        "dark",
      ),
      render(
        boulderShareCard({
          ...(boulderCard() as any),
          activityDate: "2026-10-25",
          sends: 1,
          flashes: 0,
          topGrade: "6A",
          grades: [{ grade: "6A", gradeRank: 10, sends: 1, flashes: 0 }],
          gymName: "SECRET_SESSION_GYM",
          notes: "SECRET_NOTES",
          photos: ["file:///SECRET_PHOTO.jpg"],
        } as any),
        "light",
      ),
    ];
    for (const tree of trees) {
      const all = strings(tree).join("\n");
      for (const forbidden of [
        "SECRET",
        "84.2",
        "412",
        "88.8",
        "file://",
        "lurker",
        "kcal",
        "protein",
      ])
        expect(all).not.toContain(forbidden);
    }
  });
});
