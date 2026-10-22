import type { ApiClient } from "@mizyun/api-client";
import {
  stretchRefinedPlanSchema,
  stretchRefineResponseSchema,
  type StretchRefinedPlan,
  type StretchRefineResponse,
} from "@mizyun/contracts";
import {
  stretchPlanCoversEverySource,
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

/**
 * Rebuild a stored or received plan on the device; null when invalid or
 * when it leaves out one of today's sessions (the deterministic plan never
 * does), so a bigger workout cannot crowd out a climb or an activity.
 */
const toPlan = (
  input: StretchSessionInput,
  plan: StretchRefinedPlan | null,
): StretchSessionPlan | null => {
  if (plan === null) return null;
  const rebuilt = stretchPlanFromChoice(input, {
    picks: plan.steps.map((step) => ({
      id: step.exerciseId,
      holdSeconds: step.holdSeconds,
    })),
    focusMuscles: plan.focusMuscles,
  });
  return rebuilt !== null && stretchPlanCoversEverySource(input, rebuilt)
    ? rebuilt
    : null;
};

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

// One load per account, day and training at a time: the reminder-time
// preparation and the stretch screen may ask together. Loads for one
// account run one after another so the attempt count is never raced.
const inFlight = new Map<string, Promise<StretchSessionPlan | null>>();
const accountQueue = new Map<string, Promise<unknown>>();

/** Re-checked before the request and before caching its answer. */
export type StretchAiAllowed = () => boolean | Promise<boolean>;
const always: StretchAiAllowed = () => true;
const isAllowed = async (allowed: StretchAiAllowed): Promise<boolean> => {
  try {
    return await allowed();
  } catch {
    return false;
  }
};

/**
 * The tailored plan for today's training: from the cache when present,
 * otherwise one server call (counted against the daily attempts). Null
 * means "keep the deterministic plan". Concurrent calls for the same
 * training share one load.
 */
export const loadTailoredStretchPlan = (
  userId: string,
  input: StretchSessionInput,
  localDate: string,
  client: ApiClient,
  store: StretchAiStore = SecureStore,
  allowed: StretchAiAllowed = always,
): Promise<StretchSessionPlan | null> => {
  const key = JSON.stringify([
    userId,
    localDate,
    stretchTrainingFingerprint(input),
  ]);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const previous = accountQueue.get(userId) ?? Promise.resolve();
  const load = previous
    .catch(() => {})
    .then(() =>
      loadTailoredStretchPlanOnce(
        userId,
        input,
        localDate,
        client,
        store,
        allowed,
      ),
    )
    .finally(() => {
      inFlight.delete(key);
      if (accountQueue.get(userId) === load) accountQueue.delete(userId);
    });
  inFlight.set(key, load);
  accountQueue.set(userId, load);
  return load;
};

const loadTailoredStretchPlanOnce = async (
  userId: string,
  input: StretchSessionInput,
  localDate: string,
  client: ApiClient,
  store: StretchAiStore,
  allowed: StretchAiAllowed,
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
  if (!(await isAllowed(allowed))) return null;
  // Count the attempt before the call so a crash cannot repeat it freely.
  await store
    .setItemAsync(
      keyFor(userId),
      JSON.stringify({
        date: localDate,
        attempts: attempts + 1,
        // The earlier plan was for other training; never restore it after a
        // revocation cleared the cache during the consent check.
        fingerprint: null,
        plan: null,
      } satisfies StretchAiCache),
    )
    .catch(() => {});
  const received = await requestTailoredStretchPlan(client, input).catch(
    () => null,
  );
  const plan = toPlan(input, received);
  if (plan === null || received === null) return null;
  // Consent revoked or account switched while waiting: keep nothing.
  if (!(await isAllowed(allowed))) return null;
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
