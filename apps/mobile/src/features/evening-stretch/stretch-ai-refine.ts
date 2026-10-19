import type { ApiClient } from "@mizyun/api-client";
import {
  stretchRefinedPlanSchema,
  stretchRefineResponseSchema,
  type StretchRefinedPlan,
  type StretchRefineResponse,
} from "@mizyun/contracts";
import {
  stretchPlanFromChoice,
  type StretchSessionInput,
  type StretchSessionPlan,
} from "@mizyun/core";
import * as SecureStore from "expo-secure-store";

/**
 * AI-tailored evening stretch (ADR-0076). The deterministic plan is always
 * shown first; a tailored plan replaces it only when the server returns one
 * that the device re-validates against the catalog. One call per local day
 * for the same training (at most two a day), cached on the device per user.
 */

export interface StretchAiStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync?(key: string): Promise<unknown>;
}

interface StretchAiCache {
  readonly date: string;
  readonly attempts: number;
  readonly fingerprint: string | null;
  readonly plan: StretchRefinedPlan | null;
}

export const MAX_STRETCH_AI_ATTEMPTS_PER_DAY = 2;

const keyFor = (userId: string): string =>
  `mizyun.evening-stretch-ai.${userId}`;

/** Order-insensitive identity of today's training. */
export const stretchTrainingFingerprint = (
  input: StretchSessionInput,
): string =>
  JSON.stringify({
    exercises: [...input.exercises]
      .map((item) => [item.name.trim().toLowerCase(), item.setCount] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1])),
    activities: [...input.activities].sort(),
  });

const isCache = (value: unknown): value is StretchAiCache => {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<StretchAiCache>;
  return (
    typeof c.date === "string" &&
    Number.isInteger(c.attempts) &&
    (c.fingerprint === null || typeof c.fingerprint === "string") &&
    (c.plan === null || stretchRefinedPlanSchema.safeParse(c.plan).success)
  );
};

const readCache = async (
  userId: string,
  store: StretchAiStore,
): Promise<StretchAiCache | null> => {
  try {
    const raw = await store.getItemAsync(keyFor(userId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCache(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Rebuild a stored or received plan on the device; null when invalid. */
const toPlan = (
  input: StretchSessionInput,
  plan: StretchRefinedPlan | null,
): StretchSessionPlan | null =>
  plan === null
    ? null
    : stretchPlanFromChoice(input, {
        picks: plan.steps.map((step) => ({
          id: step.exerciseId,
          holdSeconds: step.holdSeconds,
        })),
        focusMuscles: plan.focusMuscles,
      });

/** Today's cached tailored plan for this training, without a network call. */
export const peekTailoredStretchPlan = async (
  userId: string,
  input: StretchSessionInput,
  localDate: string,
  store: StretchAiStore = SecureStore,
): Promise<StretchSessionPlan | null> => {
  const cache = await readCache(userId, store);
  if (
    cache === null ||
    cache.date !== localDate ||
    cache.fingerprint !== stretchTrainingFingerprint(input)
  ) {
    return null;
  }
  return toPlan(input, cache.plan);
};

export const requestTailoredStretchPlan = async (
  client: ApiClient,
  input: StretchSessionInput,
): Promise<StretchRefinedPlan | null> => {
  const result = await client.request<StretchRefineResponse>({
    method: "POST",
    path: "/v1/stretch-plans/refine",
    body: {
      exercises: input.exercises
        .slice(0, 40)
        .map((item) => ({
          name: item.name.trim().slice(0, 120),
          setCount: Math.min(100, Math.max(0, Math.round(item.setCount))),
        }))
        .filter((item) => item.name.length > 0),
      activities: [...new Set(input.activities)],
    },
    schema: stretchRefineResponseSchema,
  });
  return result.ok ? result.value.plan : null;
};

/**
 * The tailored plan for today's training: from the cache when present,
 * otherwise one server call (counted against the daily attempts). Null
 * means "keep the deterministic plan".
 */
export const loadTailoredStretchPlan = async (
  userId: string,
  input: StretchSessionInput,
  localDate: string,
  client: ApiClient,
  store: StretchAiStore = SecureStore,
): Promise<StretchSessionPlan | null> => {
  if (input.exercises.length === 0 && input.activities.length === 0) {
    return null;
  }
  const fingerprint = stretchTrainingFingerprint(input);
  const cache = await readCache(userId, store);
  const today = cache !== null && cache.date === localDate ? cache : null;
  if (today !== null && today.fingerprint === fingerprint && today.plan) {
    return toPlan(input, today.plan);
  }
  const attempts = today?.attempts ?? 0;
  if (attempts >= MAX_STRETCH_AI_ATTEMPTS_PER_DAY) return null;
  // Count the attempt before the call so a crash cannot repeat it freely.
  await store
    .setItemAsync(
      keyFor(userId),
      JSON.stringify({
        date: localDate,
        attempts: attempts + 1,
        fingerprint: today?.fingerprint ?? null,
        plan: today?.plan ?? null,
      } satisfies StretchAiCache),
    )
    .catch(() => {});
  const received = await requestTailoredStretchPlan(client, input).catch(
    () => null,
  );
  const plan = toPlan(input, received);
  if (plan === null || received === null) return null;
  await store
    .setItemAsync(
      keyFor(userId),
      JSON.stringify({
        date: localDate,
        attempts: attempts + 1,
        fingerprint,
        plan: received,
      } satisfies StretchAiCache),
    )
    .catch(() => {});
  return plan;
};

/** Account erasure and sign-out cleanup. */
export const clearTailoredStretchPlan = async (
  userId: string,
  store: StretchAiStore = SecureStore,
): Promise<void> => {
  try {
    if (typeof store.deleteItemAsync === "function") {
      await store.deleteItemAsync(keyFor(userId));
    } else {
      await store.setItemAsync(keyFor(userId), "null");
    }
  } catch {
    // Best effort.
  }
};
