import {
  coachWorkoutEditProposalSchema,
  type CoachWorkoutEditProposal,
} from "@mizyun/contracts";
import type { MovementPattern, StoredWorkout } from "@mizyun/core";

const workoutEditPatterns: readonly RegExp[] = [
  /\b(?:change|modify|edit|update|adjust|swap|replace|substitute|remove|add|reduce|increase|lower|raise)\b.*\b(?:workout|session|exercise|exercises|volume|sets?|reps?|plan)\b/i,
  /\b(?:replace|substitute)\s+([a-z0-9\s-]+)\s+(?:with|by|for)\s+([a-z0-9\s-]+)\b/i,
  /\bswap\s+([a-z0-9\s-]+)\s+(?:for|with)\s+([a-z0-9\s-]+)\b/i,
  /\bchange\s+([a-z0-9\s-]+)\s+to\s+([a-z0-9\s-]+)\b/i,
  /\b(?:remove|delete|drop)\s+([a-z0-9\s-]+)\s+from\b/i,
  /\b(?:add|include)\s+([a-z0-9\s-]+)\s+to\b/i,
  /(?:^|\s)(?:zmeň|uprav|vymeň|nahraď|pridaj|odober|zníž|zvýš)(?:\s|$|[a-zá-ž])/iu,
];

export const isWorkoutEditProposalIntent = (text: string): boolean => {
  const normalized = text.trim();
  return (
    normalized.length >= 3 &&
    workoutEditPatterns.some((pattern) => pattern.test(normalized))
  );
};

export interface PlannedExerciseLike {
  readonly catalogId: string;
  readonly name: string;
  readonly movementPattern: MovementPattern;
  readonly equipment?: readonly string[];
  readonly sets: number;
  readonly repsMin: number | null;
  readonly repsMax: number | null;
  readonly durationMinutes: number | null;
  readonly restSeconds: number;
  readonly progression?: "double_progression" | "time_progression";
}

const extractWorkoutPlannedExercises = (
  workout: StoredWorkout,
): PlannedExerciseLike[] => {
  const details = workout.details;
  if (!details || typeof details !== "object") return [];

  const coachPlan = (details as Record<string, unknown>).coachPlan;
  if (
    coachPlan &&
    typeof coachPlan === "object" &&
    Array.isArray((coachPlan as Record<string, unknown>).exercises)
  ) {
    return (coachPlan as { exercises: PlannedExerciseLike[] }).exercises;
  }

  const aiDraft = (details as Record<string, unknown>).aiDraft;
  if (aiDraft && typeof aiDraft === "object") {
    const session = (aiDraft as Record<string, unknown>).session;
    if (
      session &&
      typeof session === "object" &&
      Array.isArray((session as Record<string, unknown>).exercises)
    ) {
      return (session as { exercises: PlannedExerciseLike[] }).exercises;
    }
  }

  return [];
};

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const inferMovementPattern = (name: string): MovementPattern => {
  const lower = name.toLowerCase();
  if (
    lower.includes("squat") ||
    lower.includes("lunge") ||
    lower.includes("leg press") ||
    lower.includes("extension")
  ) {
    return "knee_dominant";
  }
  if (
    lower.includes("deadlift") ||
    lower.includes("rdl") ||
    lower.includes("hinge") ||
    lower.includes("bridge") ||
    (lower.includes("curl") && lower.includes("leg"))
  ) {
    return "hip_hinge";
  }
  if (
    lower.includes("bench") ||
    lower.includes("incline") ||
    lower.includes("push-up") ||
    lower.includes("pushup") ||
    lower.includes("chest") ||
    lower.includes("fly") ||
    lower.includes("dip")
  ) {
    return "horizontal_push";
  }
  if (
    lower.includes("overhead") ||
    lower.includes("shoulder") ||
    lower.includes("military") ||
    lower.includes("arnold") ||
    (lower.includes("press") && !lower.includes("leg"))
  ) {
    return "vertical_push";
  }
  if (
    lower.includes("pull-up") ||
    lower.includes("pullup") ||
    lower.includes("chin-up") ||
    lower.includes("lat pulldown")
  ) {
    return "vertical_pull";
  }
  if (
    lower.includes("row") ||
    lower.includes("face pull") ||
    lower.includes("y raise")
  ) {
    return "horizontal_pull";
  }
  if (
    lower.includes("plank") ||
    lower.includes("dead bug") ||
    lower.includes("crunch") ||
    lower.includes("ab") ||
    lower.includes("core")
  ) {
    return "core";
  }
  if (
    lower.includes("stretch") ||
    lower.includes("mobility") ||
    lower.includes("flow")
  ) {
    return "mobility";
  }
  return "horizontal_push";
};

export const findTargetWorkout = (
  workouts: readonly StoredWorkout[],
  text: string,
): StoredWorkout | null => {
  if (workouts.length === 0) return null;

  const lowerText = text.toLowerCase();

  // 1. Check if workout name is explicitly mentioned in text
  for (const workout of workouts) {
    if (workout.name && lowerText.includes(workout.name.toLowerCase())) {
      return workout;
    }
  }

  // 2. Check if a target day or session index is mentioned (e.g. "thursday", "sat", "day 2")
  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  for (const workout of workouts) {
    const details = workout.details as Record<string, unknown> | undefined;
    const coachPlan = details?.coachPlan as
      { targetDay?: string; sessionIndex?: number } | undefined;
    if (coachPlan?.targetDay) {
      const targetDate = new Date(coachPlan.targetDay);
      if (!Number.isNaN(targetDate.getTime())) {
        const dayName = dayNames[targetDate.getUTCDay()];
        if (dayName && lowerText.includes(dayName)) {
          return workout;
        }
      }
    }
    if (coachPlan?.sessionIndex) {
      if (
        lowerText.includes(`day ${coachPlan.sessionIndex}`) ||
        lowerText.includes(`session ${coachPlan.sessionIndex}`)
      ) {
        return workout;
      }
    }
  }

  // 3. Prefer the earliest incomplete / scheduled workout
  const incomplete = workouts.filter((w) => w.completedAt === null);
  if (incomplete.length > 0) {
    return (
      incomplete.sort(
        (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
      )[0] ?? null
    );
  }

  // 4. Fallback to newest workout
  return (
    [...workouts].sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
    )[0] ?? null
  );
};

export const buildWorkoutEditProposal = (
  targetWorkout: StoredWorkout,
  userText: string,
): CoachWorkoutEditProposal | null => {
  const existingExercises = extractWorkoutPlannedExercises(targetWorkout);
  let updatedExercises = [...existingExercises];
  const summaryParts: string[] = [];

  const lowerText = userText.toLowerCase();

  // 1. Replacement intent: replace/swap X with Y
  const replaceMatch =
    userText.match(
      /\b(?:replace|substitute|swap)\s+([a-zA-Z0-9\s-]+?)\s+(?:with|by|for)\s+([a-zA-Z0-9\s-]+?)(?:\.|$|\band\b|\bin\b)/i,
    ) ||
    userText.match(
      /\bchange\s+([a-zA-Z0-9\s-]+?)\s+to\s+([a-zA-Z0-9\s-]+?)(?:\.|$|\band\b|\bin\b)/i,
    ) ||
    userText.match(
      /\b(?:vymeň|nahraď)\s+([a-zA-Z0-9\s-]+?)\s+(?:za|na)\s+([a-zA-Z0-9\s-]+?)(?:\.|$|\ba\b)/i,
    );

  if (replaceMatch && replaceMatch[1] && replaceMatch[2]) {
    const fromQuery = replaceMatch[1].trim().toLowerCase();
    const toName = replaceMatch[2].trim();
    const index = updatedExercises.findIndex(
      (e) =>
        e.name.toLowerCase().includes(fromQuery) ||
        fromQuery.includes(e.name.toLowerCase()),
    );
    if (index >= 0) {
      const current = updatedExercises[index]!;
      const newPattern = inferMovementPattern(toName);
      updatedExercises[index] = {
        catalogId: slugify(toName),
        name: toName,
        movementPattern: newPattern,
        sets: current.sets,
        repsMin: current.repsMin ?? 8,
        repsMax: current.repsMax ?? 12,
        durationMinutes: current.durationMinutes,
        restSeconds: current.restSeconds,
        progression: "double_progression",
      };
      summaryParts.push(`Replaced ${current.name} with ${toName}`);
    } else {
      // If not matching existing planned exercise name, replace first or append
      const newPattern = inferMovementPattern(toName);
      const newEx: PlannedExerciseLike = {
        catalogId: slugify(toName),
        name: toName,
        movementPattern: newPattern,
        sets: 3,
        repsMin: 8,
        repsMax: 12,
        durationMinutes: null,
        restSeconds: 90,
        progression: "double_progression",
      };
      if (updatedExercises.length > 0) {
        summaryParts.push(
          `Replaced ${updatedExercises[0]?.name} with ${toName}`,
        );
        updatedExercises[0] = newEx;
      } else {
        updatedExercises.push(newEx);
        summaryParts.push(`Added ${toName}`);
      }
    }
  }

  // 2. Remove intent: remove X
  const removeMatch = userText.match(
    /\b(?:remove|delete|drop|odober|zmaž)\s+([a-zA-Z0-9\s-]+?)(?:\s+from|\.|$|\band\b)/i,
  );
  if (removeMatch && removeMatch[1] && !replaceMatch) {
    const removeQuery = removeMatch[1].trim().toLowerCase();
    const filtered = updatedExercises.filter(
      (e) =>
        !e.name.toLowerCase().includes(removeQuery) &&
        !removeQuery.includes(e.name.toLowerCase()),
    );
    if (filtered.length < updatedExercises.length && filtered.length > 0) {
      const removed = updatedExercises.find(
        (e) =>
          e.name.toLowerCase().includes(removeQuery) ||
          removeQuery.includes(e.name.toLowerCase()),
      );
      updatedExercises = filtered;
      summaryParts.push(`Removed ${removed?.name ?? removeQuery}`);
    }
  }

  // 3. Sets adjustment: e.g. "3 sets", "4 sets", "reduce sets to 3"
  const setsMatch = userText.match(/\b(\d+)\s+sets?\b/i);
  if (setsMatch && setsMatch[1]) {
    const targetSets = Math.max(
      1,
      Math.min(10, Number.parseInt(setsMatch[1], 10)),
    );
    updatedExercises = updatedExercises.map((e) => ({
      ...e,
      sets: targetSets,
    }));
    summaryParts.push(
      `Adjusted target volume to ${targetSets} sets per exercise`,
    );
  }

  // If no specific parsed modification matched, provide a standard shoulder/hypertrophy adjustment or volume tune
  if (summaryParts.length === 0) {
    if (lowerText.includes("shoulder") || lowerText.includes("overhead")) {
      const toName = "Dumbbell overhead press";
      const newEx: PlannedExerciseLike = {
        catalogId: "dumbbell-overhead-press",
        name: toName,
        movementPattern: "vertical_push",
        sets: 3,
        repsMin: 8,
        repsMax: 12,
        durationMinutes: null,
        restSeconds: 90,
        progression: "double_progression",
      };
      if (updatedExercises.length > 0) {
        updatedExercises[0] = newEx;
        summaryParts.push(`Adjusted focus to shoulders with ${toName}`);
      } else {
        updatedExercises.push(newEx);
        summaryParts.push(`Added ${toName}`);
      }
    } else {
      // Default general adjustment: set standard 3 sets
      updatedExercises = updatedExercises.map((e) => ({
        ...e,
        sets: Math.max(1, Math.min(10, e.sets || 3)),
      }));
      summaryParts.push("Adjusted workout exercise plan");
    }
  }

  if (updatedExercises.length === 0) {
    return null;
  }

  return coachWorkoutEditProposalSchema.parse({
    id: crypto.randomUUID(),
    kind: "workout_edit",
    workoutId: targetWorkout.id,
    targetName: targetWorkout.name,
    notes: targetWorkout.notes ?? null,
    exercises: updatedExercises.map((e) => ({
      catalogId: e.catalogId,
      name: e.name,
      movementPattern: e.movementPattern,
      equipment: e.equipment ? [...e.equipment] : undefined,
      sets: e.sets,
      repsMin: e.repsMin,
      repsMax: e.repsMax,
      durationMinutes: e.durationMinutes,
      restSeconds: e.restSeconds,
      progression: e.progression,
    })),
    summary: summaryParts.join(". "),
  });
};
