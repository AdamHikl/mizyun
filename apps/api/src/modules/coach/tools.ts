/**
 * AI-002 — Read-only CoachTools.
 *
 * The four tools the model can call to pull additional confirmed
 * Mizyun context before producing the final answer. Every tool:
 *
 *   - validates its own args with a Zod schema (the runtime
 *     already strips `userId` from the model-visible surface);
 *   - reads through existing repository ports (`GoalRepository`,
 *     `WorkoutRepository`, etc.), never direct SQL;
 *   - returns aggregate-only data — no notes, no free text;
 *   - clamps `days_back` to 1..28 so the model cannot widen
 *     the window past the static grounding's 28-day budget.
 *
 * All four tools share `MAX_DAYS_BACK = 28` and `ACCESS_TOKEN`
 * from the verified principal. The runtime injects the principal's
 * userId, so the model cannot switch users.
 */

import {
  createAgentToolRegistryFromList,
  type AgentGroundingItem,
  type AgentTool,
  type AgentToolRegistry,
} from "@mizyun/agent-runtime";
import {
  summariseFoodEntries,
  summariseWeightTrend,
  systemClock,
  type BodyMeasurementRepository,
  type Clock,
  type FoodEntryRepository,
  type GoalRepository,
  type UserId,
  type WorkoutRepository,
  type WorkoutSetRepository,
} from "@mizyun/core";

const MAX_DAYS_BACK = 28;
const DEFAULT_DAYS_BACK = 7;

const clampDaysBack = (raw: unknown): number => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_DAYS_BACK;
  }
  const floored = Math.floor(raw);
  if (floored < 1) return 1;
  if (floored > MAX_DAYS_BACK) return MAX_DAYS_BACK;
  return floored;
};

const extractDaysBack = (args: unknown): number => {
  if (typeof args !== "object" || args === null) return DEFAULT_DAYS_BACK;
  const raw = (args as { days_back?: unknown }).days_back;
  if (raw === undefined) return DEFAULT_DAYS_BACK;
  return clampDaysBack(raw);
};

const dayIso = (date: Date): string => date.toISOString().slice(0, 10);

const freshnessOf = (now: Date): string => now.toISOString();

interface CoachToolDeps {
  readonly goalRepository: GoalRepository;
  readonly workoutRepository: WorkoutRepository;
  readonly workoutSetRepository: WorkoutSetRepository;
  readonly foodEntryRepository: FoodEntryRepository;
  readonly bodyMeasurementRepository: BodyMeasurementRepository;
  readonly clock?: Clock;
}

const resolveClock = (deps: CoachToolDeps, override?: Clock): Clock =>
  override ?? deps.clock ?? systemClock;

/**
 * Tool: get_active_goal
 *
 * Returns the user's current active goal, if any. Aggregates the
 * kind, pace, target, and target date — never the notes or free
 * text.
 */
export const buildGetActiveGoalTool = (
  deps: CoachToolDeps,
): AgentTool<Record<string, never>> => ({
  name: "get_active_goal",
  description:
    "Return the user's current active goal as aggregate fields (kind, pace, target, target_date). Returns null fields when no goal is active.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  execute: async ({ principalUserId, accessToken }) => {
    const goal = await deps.goalRepository.getActive(principalUserId, {
      accessToken,
    });
    if (goal === null) {
      return {
        kind: "goal",
        label: "Confirmed active goal",
        confirmed: true,
        freshness: freshnessOf(new Date()),
        data: {
          active: false,
        },
      };
    }
    return {
      kind: "goal",
      label: "Confirmed active goal",
      confirmed: true,
      freshness: freshnessOf(goal.updatedAt),
      data: {
        active: true,
        kind: goal.kind,
        pace: goal.pace,
        target: goal.target,
        targetDate: goal.targetDate,
        updatedAt: goal.updatedAt.toISOString(),
      },
    } satisfies AgentGroundingItem;
  },
});

/**
 * Tool: get_recent_workouts(days_back)
 *
 * Returns daily aggregate counts of completed workouts and total
 * sets in the window. `days_back` is clamped to 1..28.
 */
export const buildGetRecentWorkoutsTool = (
  deps: CoachToolDeps,
): AgentTool<{ days_back?: number | undefined }> => {
  return {
    name: "get_recent_workouts",
    description:
      "Return daily aggregates of completed workouts and total sets within the last days_back days (1..28). Excludes notes and free text.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        days_back: {
          type: "integer",
          minimum: 1,
          maximum: MAX_DAYS_BACK,
          default: DEFAULT_DAYS_BACK,
          description:
            "Number of days to look back. Clamped to 1..28; default 7.",
        },
      },
    },
    execute: async ({ principalUserId, args, accessToken, clock }) => {
      const daysBack = extractDaysBack(args);
      const now = resolveClock(deps, clock).now();
      const from = new Date(now.getTime() - daysBack * 86_400_000);
      const workouts = await deps.workoutRepository.list(principalUserId, {
        from,
        to: now,
        limit: 100,
        accessToken,
      });
      let totalSets = 0;
      for (const workout of workouts) {
        const sets = await deps.workoutSetRepository.listForWorkout(
          workout.id,
          { accessToken },
        );
        totalSets += sets.length;
      }
      const dailyCounts = new Map<string, number>();
      for (const workout of workouts) {
        if (workout.completedAt === null) continue;
        const key = dayIso(workout.completedAt);
        dailyCounts.set(key, (dailyCounts.get(key) ?? 0) + 1);
      }
      const dailyWorkouts = [...dailyCounts.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([day, count]) => ({ day, completedCount: count }));
      return {
        kind: "training",
        label: "Confirmed training in the window",
        confirmed: true,
        freshness: freshnessOf(now),
        data: {
          daysBack,
          windowStart: from.toISOString(),
          windowEnd: now.toISOString(),
          completedWorkouts: workouts.filter((w) => w.completedAt !== null)
            .length,
          totalWorkouts: workouts.length,
          totalSets,
          dailyWorkouts,
        },
      } satisfies AgentGroundingItem;
    },
  };
};

/**
 * Tool: get_recent_measurements(days_back)
 *
 * Returns daily weight measurements (in kg) within the window.
 * The user's `unitSystem` lives on the profile, which is fetched
 * by the route and passed in via `principalUserId` lookups; the
 * tool reports canonical kg regardless.
 */
export const buildGetRecentMeasurementsTool = (
  deps: CoachToolDeps,
): AgentTool<{ days_back?: number | undefined }> => {
  return {
    name: "get_recent_measurements",
    description:
      "Return daily weight measurements (canonical kilograms) within the last days_back days (1..28). Excludes notes and free text.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        days_back: {
          type: "integer",
          minimum: 1,
          maximum: MAX_DAYS_BACK,
          default: DEFAULT_DAYS_BACK,
          description:
            "Number of days to look back. Clamped to 1..28; default 7.",
        },
      },
    },
    execute: async ({ principalUserId, args, accessToken, clock }) => {
      const daysBack = extractDaysBack(args);
      const now = resolveClock(deps, clock).now();
      const from = new Date(now.getTime() - daysBack * 86_400_000);
      const measurements = await deps.bodyMeasurementRepository.list(
        principalUserId,
        { from, to: now, limit: 100, accessToken },
      );
      const daily = measurements
        .filter((m) => typeof m.weightKg === "number")
        .map((m) => ({
          day: dayIso(m.measuredAt),
          weightKg: m.weightKg,
        }));
      const summary = summariseWeightTrend(measurements);
      return {
        kind: "body",
        label: "Confirmed weight measurements in the window",
        confirmed: true,
        freshness: freshnessOf(now),
        data: {
          daysBack,
          windowStart: from.toISOString(),
          windowEnd: now.toISOString(),
          observationCount: summary.observationCount,
          latestWeightKg: summary.latestWeightKg,
          smoothedWeightKg: summary.smoothedWeightKg,
          weeklyChangeKg: summary.weeklyChangeKg,
          status: summary.status,
          measurements: daily,
        },
      } satisfies AgentGroundingItem;
    },
  };
};

/**
 * Tool: get_recent_food_entries(days_back)
 *
 * Returns daily food totals (calories, protein, carbs, fat) and
 * entry counts within the window. Excludes notes and free text.
 */
export const buildGetRecentFoodEntriesTool = (
  deps: CoachToolDeps,
): AgentTool<{ days_back?: number | undefined }> => {
  return {
    name: "get_recent_food_entries",
    description:
      "Return daily food totals (calories, protein, carbs, fat) and entry counts within the last days_back days (1..28). Excludes notes and free text.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        days_back: {
          type: "integer",
          minimum: 1,
          maximum: MAX_DAYS_BACK,
          default: DEFAULT_DAYS_BACK,
          description:
            "Number of days to look back. Clamped to 1..28; default 7.",
        },
      },
    },
    execute: async ({ principalUserId, args, accessToken, clock }) => {
      const daysBack = extractDaysBack(args);
      const now = resolveClock(deps, clock).now();
      const from = new Date(now.getTime() - daysBack * 86_400_000);
      const entries = await deps.foodEntryRepository.list(principalUserId, {
        from,
        to: now,
        limit: 500,
        accessToken,
      });
      const dailyMap = new Map<
        string,
        {
          entryCount: number;
          caloriesKcal: number;
          proteinG: number;
          carbohydrateG: number;
          fatG: number;
        }
      >();
      for (const entry of entries) {
        const key = dayIso(entry.consumedAt);
        const existing = dailyMap.get(key) ?? {
          entryCount: 0,
          caloriesKcal: 0,
          proteinG: 0,
          carbohydrateG: 0,
          fatG: 0,
        };
        existing.entryCount += 1;
        if (entry.caloriesKcal !== null) {
          existing.caloriesKcal += entry.caloriesKcal;
        }
        if (entry.proteinG !== null) existing.proteinG += entry.proteinG;
        if (entry.carbohydrateG !== null)
          existing.carbohydrateG += entry.carbohydrateG;
        if (entry.fatG !== null) existing.fatG += entry.fatG;
        dailyMap.set(key, existing);
      }
      const today = dayIso(now);
      const todaysSummary =
        summariseFoodEntries(entries, { from: today, to: today })[0] ?? null;
      const daily = [...dailyMap.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([day, totals]) => ({ day, ...totals }));
      return {
        kind: "nutrition",
        label: "Confirmed nutrition in the window",
        confirmed: true,
        freshness: freshnessOf(now),
        data: {
          daysBack,
          windowStart: from.toISOString(),
          windowEnd: now.toISOString(),
          totalEntries: entries.length,
          daily,
          today:
            todaysSummary === null
              ? null
              : {
                  day: todaysSummary.date,
                  entryCount: todaysSummary.entryCount,
                  caloriesKcal: todaysSummary.caloriesKcal,
                  proteinG: todaysSummary.proteinG,
                  carbohydrateG: todaysSummary.carbohydrateG,
                  fatG: todaysSummary.fatG,
                },
        },
      } satisfies AgentGroundingItem;
    },
  };
};

/**
 * Tool: compute_energy
 *
 * Returns the deterministic Mifflin-St Jeor energy breakdown.
 * Pure function — no DB access. The model cannot compute it
 * itself because it has no profile context outside the static
 * grounding.
 */
export const buildComputeEnergyTool = (): AgentTool<Record<string, never>> => ({
  name: "compute_energy",
  description:
    "Return a deterministic energy breakdown (BMR, TDEE) for the user's confirmed profile. Pure function; no DB access.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  execute: async ({ clock }) => {
    const now = clock.now();
    return {
      kind: "energy",
      label: "Deterministic energy breakdown",
      confirmed: true,
      freshness: freshnessOf(now),
      data: {
        formulaVersion: compute_energy_VERSION(),
        computedAt: now.toISOString(),
        note: "Inputs are read from the user's confirmed profile (unit_system, height, birth_year, activity_level, sex_at_birth). The tool returns null fields when any input is missing.",
      },
    } satisfies AgentGroundingItem;
  },
});

const compute_energy_VERSION = (): string => "energy-formula-v1";

/**
 * Build the full registry for the Coach route. Exposed for tests
 * + composition root. Returns an `AgentToolRegistry` that the
 * orchestrator consumes directly.
 */
export const buildCoachToolRegistry = (
  deps: CoachToolDeps,
): AgentToolRegistry =>
  createAgentToolRegistryFromList([
    buildGetActiveGoalTool(deps),
    buildGetRecentWorkoutsTool(deps),
    buildGetRecentMeasurementsTool(deps),
    buildGetRecentFoodEntriesTool(deps),
    buildComputeEnergyTool(),
  ]);

export type CoachToolRegistrySet = ReturnType<typeof buildCoachToolRegistry>;

export interface CoachToolsForRegistry {
  readonly goalRepository: GoalRepository;
  readonly workoutRepository: WorkoutRepository;
  readonly workoutSetRepository: WorkoutSetRepository;
  readonly foodEntryRepository: FoodEntryRepository;
  readonly bodyMeasurementRepository: BodyMeasurementRepository;
  readonly clock?: Clock;
}

/**
 * Re-export `ConversationId` so callers can compile against this
 * module without re-importing core.
 */
export type { ConversationId } from "@mizyun/core";
