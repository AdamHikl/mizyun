import type { AgentGroundingItem, AgentTool } from "@mizyun/agent-runtime";
import {
  systemClock,
  type Clock,
  type FoodEntryRepository,
  type UserId,
} from "@mizyun/core";

export interface MealHistoryDeps {
  readonly foodEntryRepository: FoodEntryRepository;
  readonly clock?: Clock;
}

export interface GetMealHistoryArgs {
  readonly date?: string | undefined;
  readonly days_back?: number | undefined;
  readonly search?: string | undefined;
  readonly limit?: number | undefined;
}

const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const clampDaysBack = (raw: unknown): number => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 1;
  }
  const floored = Math.floor(raw);
  if (floored < 1) return 1;
  if (floored > 7) return 7;
  return floored;
};

const clampLimit = (raw: unknown): number => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 20;
  }
  const floored = Math.floor(raw);
  return Math.min(50, Math.max(1, floored));
};

const resolveClock = (deps: MealHistoryDeps, override?: Clock): Clock =>
  override ?? deps.clock ?? systemClock;

export const buildGetMealHistoryTool = (
  deps: MealHistoryDeps,
): AgentTool<GetMealHistoryArgs> => {
  return {
    name: "get_meal_history",
    description:
      "Query itemized logged meals and food entries for a specific date (YYYY-MM-DD) or within the last days_back days (1..7). Returns dish names, timestamps, calories, and macronutrients.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        date: {
          type: "string",
          description:
            "Target date in YYYY-MM-DD format (e.g. '2026-09-10'). If specified, searches that specific calendar day.",
        },
        days_back: {
          type: "integer",
          minimum: 1,
          maximum: 7,
          default: 1,
          description:
            "Number of days back from today to include if date is not specified (1..7, default 1).",
        },
        search: {
          type: "string",
          description:
            "Optional case-insensitive food name filter (e.g. 'eggs', 'protein shake', 'salmon').",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 20,
          description: "Maximum number of meal entries to return (default 20).",
        },
      },
    },
    execute: async ({ principalUserId, args, accessToken, clock }) => {
      const now = resolveClock(deps, clock).now();
      const safeArgs = (args ?? {}) as GetMealHistoryArgs;

      let from: Date;
      let to: Date;

      if (
        typeof safeArgs.date === "string" &&
        DATE_FORMAT_REGEX.test(safeArgs.date) &&
        !Number.isNaN(Date.parse(`${safeArgs.date}T00:00:00.000Z`))
      ) {
        from = new Date(`${safeArgs.date}T00:00:00.000Z`);
        to = new Date(`${safeArgs.date}T23:59:59.999Z`);
      } else {
        const daysBack = clampDaysBack(safeArgs.days_back);
        from = new Date(now.getTime() - daysBack * 86_400_000);
        to = now;
      }

      const entries = await deps.foodEntryRepository.list(principalUserId, {
        from,
        to,
        limit: 100,
        accessToken,
      });

      let filtered = entries;
      if (
        typeof safeArgs.search === "string" &&
        safeArgs.search.trim().length > 0
      ) {
        const query = safeArgs.search.trim().toLowerCase();
        filtered = filtered.filter((entry) =>
          entry.name.toLowerCase().includes(query),
        );
      }

      const limit = clampLimit(safeArgs.limit);
      const limited = filtered.slice(0, limit);

      const mapped = limited.map((entry) => ({
        id: entry.id,
        name: entry.name,
        caloriesKcal: entry.caloriesKcal,
        proteinG: entry.proteinG,
        carbohydrateG: entry.carbohydrateG,
        fatG: entry.fatG,
        consumedAt: entry.consumedAt.toISOString(),
      }));

      return {
        kind: "nutrition",
        label: "Logged meal history",
        confirmed: true,
        freshness: now.toISOString(),
        data: {
          count: mapped.length,
          meals: mapped,
        },
      };
    },
  };
};
