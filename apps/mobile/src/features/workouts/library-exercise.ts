import type { CatalogExercise } from "@mizyun/core";
import type { Exercise } from "@mizyun/contracts";

/** A built-in catalog entry or one of the user's saved custom exercises. */
export type LibraryExercise = CatalogExercise | Exercise;

/** True for a saved custom exercise (it already has a database record). */
export const isSavedLibraryExercise = (
  exercise: LibraryExercise,
): exercise is Exercise => "userId" in exercise;
