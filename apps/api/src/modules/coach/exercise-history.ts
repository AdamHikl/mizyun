import type { AgentGroundingItem, AgentTool } from "@mizyun/agent-runtime";
import {
  findCatalogExercise,
  getExerciseFromCatalog,
  summariseExerciseSets,
  systemClock,
  type Clock,
  type WorkoutSetRepository,
} from "@mizyun/core";

export interface ExerciseHistoryDeps {
  readonly workoutSetRepository: WorkoutSetRepository;
  readonly clock?: Clock;
}

export interface GetExerciseHistoryArgs {
  readonly exercise_name?: string | undefined;
  readonly exercise_id?: string | undefined;
  readonly limit?: number | undefined;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export const buildGetExerciseHistoryTool = (
  deps: ExerciseHistoryDeps,
): AgentTool<GetExerciseHistoryArgs> => ({
  name: "get_exercise_history",
  description:
    "Look up past performance, sets, weights (load in kg), reps, and personal records for a specific exercise by name (e.g. 'Barbell Bench Press', 'Squat', 'Deadlift', 'Incline Dumbbell Press', 'Pull-up') or exercise ID.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      exercise_name: {
        type: "string",
        description:
          "Name or keywords for the exercise (e.g. 'bench press', 'squat', 'rdl', 'pullup', 'incline dumbbell').",
      },
      exercise_id: {
        type: "string",
        description: "Optional exact exercise catalog ID if known.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: MAX_LIMIT,
        default: DEFAULT_LIMIT,
        description:
          "Maximum number of completed sets to return (1..50, default 20).",
      },
    },
  },
  execute: async ({ principalUserId, args, accessToken, clock }) => {
    const now = (clock ?? deps.clock ?? systemClock).now();
    const typedArgs = (args ?? {}) as GetExerciseHistoryArgs;
    const rawLimit = typedArgs.limit;
    const limit =
      typeof rawLimit === "number" && Number.isFinite(rawLimit)
        ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
        : DEFAULT_LIMIT;

    // 1. Resolve exercise from catalog
    let exercise = typedArgs.exercise_id
      ? getExerciseFromCatalog(typedArgs.exercise_id)
      : null;

    if (!exercise && typedArgs.exercise_name) {
      exercise = findCatalogExercise(typedArgs.exercise_name);
    }

    if (!exercise) {
      const query = typedArgs.exercise_name ?? typedArgs.exercise_id ?? "";
      return {
        kind: "training",
        label: "Exercise performance history",
        confirmed: true,
        freshness: now.toISOString(),
        data: {
          found: false,
          query,
          message: query
            ? `No exercise matching "${query}" was found in the library.`
            : "No exercise name or ID was specified.",
          summary: {
            bestLoadKg: null,
            lastSessionVolumeKg: null,
            totalLoggedSets: 0,
          },
          recentSets: [],
        },
      } satisfies AgentGroundingItem;
    }

    // 2. Query recent sets for this user & exercise
    const rawSets = await deps.workoutSetRepository.recentForExercise(
      principalUserId,
      exercise.id,
      limit,
      { accessToken },
    );

    // 3. Compute deterministic PR metrics via core summariseExerciseSets
    const summary = summariseExerciseSets(rawSets);

    const recentSets = rawSets.map((set) => ({
      id: set.id,
      workoutId: set.workoutId,
      sequence: set.sequence,
      repetitions: set.repetitions,
      loadKg: set.loadKg,
      durationSeconds: set.durationSeconds,
      distanceMeters: set.distanceMeters,
      perceivedExertion: set.perceivedExertion,
      completedAt: set.completedAt ? set.completedAt.toISOString() : null,
      createdAt: set.createdAt.toISOString(),
    }));

    return {
      kind: "training",
      label: `Exercise performance history for ${exercise.name}`,
      confirmed: true,
      freshness: now.toISOString(),
      data: {
        found: true,
        exercise: {
          id: exercise.id,
          name: exercise.name,
          movementPattern: exercise.movementPattern,
          category: exercise.category,
          equipment: exercise.equipment,
        },
        summary: {
          bestLoadKg: summary.bestLoadKg,
          lastSessionVolumeKg: summary.lastSessionVolumeKg,
          totalLoggedSets: summary.totalSetCount,
        },
        recentSets,
      },
    } satisfies AgentGroundingItem;
  },
});
