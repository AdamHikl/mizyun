import { getCatalogExerciseNames, type CatalogExercise } from "@mizyun/core";

const normalizeName = (name: string): string => name.trim().toLowerCase();

/** Match deliberate catalog equivalents without changing any stored record. */
export function findCatalogExerciseRecord<
  T extends { readonly id: string; readonly name: string },
>(records: readonly T[], catalogExercise: CatalogExercise): T | null {
  const canonicalName = normalizeName(catalogExercise.name);
  const canonicalMatches = records.filter(
    (record) => normalizeName(record.name) === canonicalName,
  );
  if (canonicalMatches.length > 0) {
    return canonicalMatches.length === 1 ? (canonicalMatches[0] ?? null) : null;
  }

  const previousNames = new Set(
    getCatalogExerciseNames(catalogExercise).map(normalizeName),
  );
  const previousMatches = records.filter((record) =>
    previousNames.has(normalizeName(record.name)),
  );
  return previousMatches.length === 1 ? (previousMatches[0] ?? null) : null;
}
