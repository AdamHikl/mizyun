import type { FoodEntry } from "@mizyun/contracts";

import type { DayGroupSummary, FoodDayGroup } from "./meal-lifecycle-data";

const MAX_DETAILS_DEPTH = 8;
const MAX_DETAIL_STRINGS = 64;
const SEARCHABLE_DETAIL_KEYS = new Set([
  "assumptions",
  "brand",
  "description",
  "flavor",
  "flavour",
  "ingredient",
  "ingredients",
  "label",
  "mealgroup",
  "mealgroupname",
  "name",
  "note",
  "notes",
  "refineinstruction",
  "title",
  "warnings",
]);

const collectDetailStrings = (
  value: unknown,
  strings: string[],
  visited: Set<object>,
  depth: number,
  includeStrings: boolean,
): void => {
  if (typeof value === "string") {
    if (includeStrings && strings.length < MAX_DETAIL_STRINGS) {
      strings.push(value);
    }
    return;
  }
  if (
    value === null ||
    typeof value !== "object" ||
    depth >= MAX_DETAILS_DEPTH ||
    strings.length >= MAX_DETAIL_STRINGS
  ) {
    return;
  }
  if (visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const nestedValue of value) {
      collectDetailStrings(
        nestedValue,
        strings,
        visited,
        depth + 1,
        includeStrings,
      );
    }
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    collectDetailStrings(
      nestedValue,
      strings,
      visited,
      depth + 1,
      includeStrings || SEARCHABLE_DETAIL_KEYS.has(key.toLowerCase()),
    );
  }
};

const searchableTextFor = (entry: FoodEntry): string => {
  const detailStrings: string[] = [];
  collectDetailStrings(
    entry.details,
    detailStrings,
    new Set<object>(),
    0,
    false,
  );
  return [entry.name, ...detailStrings].join("\n").toLowerCase();
};

const summarizeEntries = (
  entries: ReadonlyArray<FoodEntry>,
): DayGroupSummary => {
  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let hasAnyCalories = false;
  let hasAnyProtein = false;
  let hasAnyCarbs = false;
  let hasAnyFat = false;

  for (const entry of entries) {
    if (entry.caloriesKcal !== null) {
      hasAnyCalories = true;
      calories += entry.caloriesKcal;
    }
    if (entry.proteinG !== null) {
      hasAnyProtein = true;
      protein += entry.proteinG;
    }
    if (entry.carbohydrateG !== null) {
      hasAnyCarbs = true;
      carbs += entry.carbohydrateG;
    }
    if (entry.fatG !== null) {
      hasAnyFat = true;
      fat += entry.fatG;
    }
  }

  return {
    entryCount: entries.length,
    caloriesKcal: hasAnyCalories ? Math.round(calories) : null,
    proteinG: hasAnyProtein ? Math.round(protein * 10) / 10 : null,
    carbohydrateG: hasAnyCarbs ? Math.round(carbs * 10) / 10 : null,
    fatG: hasAnyFat ? Math.round(fat * 10) / 10 : null,
  };
};

/**
 * Filters the already-loaded meal history without changing its day or entry order.
 * A blank query returns the original groups reference so callers do no extra work.
 */
export const filterFoodDayGroups = (
  groups: ReadonlyArray<FoodDayGroup>,
  query: string,
): ReadonlyArray<FoodDayGroup> => {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return groups;

  const filteredGroups: FoodDayGroup[] = [];
  for (const group of groups) {
    const entries = group.entries.filter((entry) =>
      searchableTextFor(entry).includes(normalizedQuery),
    );
    if (entries.length === 0) continue;

    filteredGroups.push({
      ...group,
      summary: summarizeEntries(entries),
      entries,
    });
  }
  return filteredGroups;
};
