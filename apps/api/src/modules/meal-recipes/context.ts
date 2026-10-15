import { createHash } from "node:crypto";
import {
  buildMealRecipeMacroContext,
  recurringMealLocalDateAt,
  type StoredFoodEntry,
  type StoredProfile,
  type UserId,
} from "@mizyun/core";
import {
  computeRouteSummary,
  type EnergyRoutesOptions,
} from "../energy/index.js";
export const recipeDigest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
/**
 * UTC offset in whole minutes of an IANA zone at an instant, so the energy
 * summary uses the same local day as the profile. Falls back to 0 (UTC) for
 * an invalid or unsupported zone.
 */
export function utcOffsetMinutesAt(instant: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(instant);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((item) => item.type === type)?.value);
    const local = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second"),
    );
    const wholeSecond = Math.floor(instant.getTime() / 1000) * 1000;
    const offset = Math.round((local - wholeSecond) / 60_000);
    return Number.isSafeInteger(offset) && Math.abs(offset) <= 18 * 60
      ? offset
      : 0;
  } catch {
    return 0;
  }
}
export async function loadOwnedRecipeContext(
  repositories: EnergyRoutesOptions,
  userId: UserId,
  accessToken: string,
  profile: StoredProfile,
  now: Date,
) {
  const timeZone = profile.timezone;
  const localDate = recurringMealLocalDateAt(now, timeZone);
  const midnight = Date.parse(`${localDate}T00:00:00Z`);
  const from = new Date(midnight - 18 * 3600_000),
    to = new Date(midnight + 42 * 3600_000);
  const entries: StoredFoodEntry[] = [];
  let complete = false,
    cursor: { consumedAt: Date; id: string } | null = null;
  const seen = new Set<string>();
  for (let page = 0; page < 50; page++) {
    const rows = await repositories.foodEntryRepository.list(userId, {
      from,
      to,
      limit: 100,
      cursor,
      accessToken,
    });
    if (
      rows.length > 100 ||
      new Set(rows.map((row) => row.id)).size !== rows.length ||
      rows.some((row) => row.userId !== userId || seen.has(row.id))
    )
      throw new Error("Invalid owned intake read");
    for (const row of rows) {
      seen.add(row.id);
      if (recurringMealLocalDateAt(row.consumedAt, timeZone) === localDate)
        entries.push(row);
    }
    if (rows.length < 100) {
      complete = true;
      break;
    }
    const last = rows.at(-1)!;
    cursor = { consumedAt: last.consumedAt, id: last.id };
  }
  const sum = (field: "proteinG" | "carbohydrateG" | "fatG") =>
    entries.every((entry) => entry[field] !== null)
      ? Math.round(
          entries.reduce((total, entry) => total + entry[field]!, 0) * 100,
        ) / 100
      : null;
  // Only an exhausted read proves an empty day; otherwise intake stays unknown.
  const summary = entries.length
    ? {
        date: localDate,
        entryCount: entries.length,
        proteinG: sum("proteinG"),
        carbohydrateG: sum("carbohydrateG"),
        fatG: sum("fatG"),
      }
    : complete
      ? {
          date: localDate,
          entryCount: 0,
          proteinG: 0,
          carbohydrateG: 0,
          fatG: 0,
        }
      : null;
  const energy = await computeRouteSummary(
    repositories,
    userId,
    accessToken,
    {
      activityLevel: null,
      sexAtBirth: null,
      utcOffsetMinutes: utcOffsetMinutesAt(now, timeZone),
    },
    now,
  );
  const goal = await repositories.goalRepository.getActive(userId, {
    accessToken,
  });
  const snapshot = {
    localDate,
    timeZone,
    generatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    energyFormulaVersion: energy.formulaVersion,
    profileRevision: profile.updatedAt.toISOString(),
    goalRevision: recipeDigest({
      goal: goal?.updatedAt.toISOString() ?? "no_goal",
      targets: [
        energy.targetProteinG,
        energy.targetCarbohydrateG,
        energy.targetFatG,
      ],
      inputs: energy.inputs,
    }),
    intakeRevision: recipeDigest(
      entries
        .map((entry) => [
          entry.id,
          entry.updatedAt,
          entry.proteinG,
          entry.carbohydrateG,
          entry.fatG,
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ),
    constraintsRevision: recipeDigest(
      profile.coachingPreferences.dietaryPreferences,
    ),
  };
  return buildMealRecipeMacroContext({
    energy,
    summary,
    snapshot,
    coverage: "logged_so_far",
    intakeReadComplete: complete,
    now,
  });
}
