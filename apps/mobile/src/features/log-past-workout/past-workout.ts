import type { ApiClient, ApiError } from "@mizyun/api-client";
import { withWorkoutLifecycle } from "@mizyun/core";
import {
  workoutCreateSchema,
  workoutResponseSchema,
  workoutSetCreateSchema,
  workoutSetListResponseSchema,
  workoutSetResponseSchema,
  workoutSetTypeSchema,
  type WorkoutCreate,
  type WorkoutResponse,
  type WorkoutSetCreate,
  type WorkoutSetListResponse,
  type WorkoutSetResponse,
  type WorkoutSetType,
} from "@mizyun/contracts";
import {
  clearLoggingDraft,
  loadRequiredLoggingDraft,
  saveLoggingDraft,
} from "@/features/logging-draft-storage";
import { displayWeightToKilograms } from "@/lib/weight-units";

/**
 * A strength workout entered after the fact. It is created already
 * completed, so it never becomes the active session, and it carries no
 * Health export marker because its times are remembered, not observed.
 */
export interface PastWorkoutSetInput {
  readonly key: string;
  readonly setType: WorkoutSetType;
  readonly reps: string;
  readonly load: string;
}
export interface PastWorkoutExercise {
  readonly key: string;
  readonly exerciseId: string;
  readonly name: string;
  readonly catalogId?: string;
  readonly sets: readonly PastWorkoutSetInput[];
}
export interface PastWorkoutForm {
  readonly name: string;
  /** Local calendar date, YYYY-MM-DD. */
  readonly date: string;
  /** Local 24-hour start time, HH:MM. */
  readonly startTime: string;
  readonly durationMinutes: string;
  readonly notes: string;
  readonly unitSystem: "metric" | "imperial";
  readonly exercises: readonly PastWorkoutExercise[];
}
/**
 * Kept small for SecureStore: request bodies are rebuilt from the locked form
 * with these frozen instants, so every retry replays identical payloads even
 * if the device timezone changes.
 */
export interface PastWorkoutPending {
  readonly operationId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  /** Known once the server confirmed the workout; sets resume against it. */
  readonly workoutId: string | null;
}
export interface PastWorkoutRequest {
  readonly workout: WorkoutCreate & { clientOperationId: string };
  readonly sets: readonly (WorkoutSetCreate & { sequence: number })[];
}
export interface PastWorkoutDraft {
  readonly version: 1;
  readonly form: PastWorkoutForm;
  readonly pending: PastWorkoutPending | null;
}

export const MAX_PAST_WORKOUT_MINUTES = 720;
export const MAX_PAST_WORKOUT_SETS = 100;
export const PAST_WORKOUT_ENTRY_MODE = "past";

const pad = (n: number) => String(n).padStart(2, "0");
export const localDateString = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** A calendar date `days` before `now` in device-local time. */
export const localDateDaysAgo = (now: Date, days: number): string =>
  localDateString(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - days),
  );

export const emptyPastWorkoutForm = (
  unitSystem: "metric" | "imperial",
  now: Date = new Date(),
): PastWorkoutForm => ({
  name: "",
  date: localDateDaysAgo(now, 1),
  startTime: "18:00",
  durationMinutes: "60",
  notes: "",
  unitSystem,
  exercises: [],
});

const str = (v: unknown): v is string => typeof v === "string";
const isSetInput = (v: unknown): v is PastWorkoutSetInput => {
  if (!v || typeof v !== "object") return false;
  const s = v as PastWorkoutSetInput;
  return (
    str(s.key) &&
    str(s.reps) &&
    str(s.load) &&
    workoutSetTypeSchema.safeParse(s.setType).success
  );
};
const isExercise = (v: unknown): v is PastWorkoutExercise => {
  if (!v || typeof v !== "object") return false;
  const e = v as PastWorkoutExercise;
  return (
    str(e.key) &&
    str(e.exerciseId) &&
    str(e.name) &&
    (e.catalogId === undefined || str(e.catalogId)) &&
    Array.isArray(e.sets) &&
    e.sets.every(isSetInput)
  );
};
export const isPastWorkoutDraft = (
  value: unknown,
): value is PastWorkoutDraft => {
  if (!value || typeof value !== "object") return false;
  const d = value as PastWorkoutDraft;
  const f = d.form;
  if (
    d.version !== 1 ||
    !f ||
    typeof f !== "object" ||
    !(["name", "date", "startTime", "durationMinutes", "notes"] as const).every(
      (k) => str(f[k]),
    ) ||
    !(f.unitSystem === "metric" || f.unitSystem === "imperial") ||
    !Array.isArray(f.exercises) ||
    !f.exercises.every(isExercise)
  )
    return false;
  if (d.pending === null) return true;
  const p = d.pending;
  return (
    !!p &&
    typeof p === "object" &&
    (p.workoutId === null || str(p.workoutId)) &&
    str(p.operationId) &&
    // Structural only: a draft that newer validation rejects must still load
    // so its pending save can be edited or discarded.
    [p.startedAt, p.completedAt].every(
      (v) => str(v) && Number.isFinite(Date.parse(v)),
    )
  );
};

export const hasPastWorkoutContent = (draft: PastWorkoutDraft): boolean =>
  draft.pending !== null ||
  draft.form.exercises.length > 0 ||
  draft.form.name.trim().length > 0 ||
  draft.form.notes.trim().length > 0;

export const pastWorkoutDraftStore = {
  load: (userId: string) =>
    loadRequiredLoggingDraft(userId, "past-workout", isPastWorkoutDraft),
  save: (userId: string, draft: PastWorkoutDraft) =>
    saveLoggingDraft(userId, "past-workout", draft),
  clear: (userId: string) => clearLoggingDraft(userId, "past-workout"),
};
export type PastWorkoutDraftStore = typeof pastWorkoutDraftStore;

/** Device-local wall time to an instant; null when the time does not exist (DST gap) or is malformed. */
export const localInstant = (date: string, time: string): Date | null => {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) return null;
  const [y, mo, da, h, mi] = [d[1], d[2], d[3], t[1], t[2]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const value = new Date(y, mo - 1, da, h, mi);
  return value.getFullYear() === y &&
    value.getMonth() === mo - 1 &&
    value.getDate() === da &&
    value.getHours() === h &&
    value.getMinutes() === mi
    ? value
    : null;
};

const parseOptional = (raw: string): number | null | "invalid" => {
  const text = raw.trim();
  if (text.length === 0) return null;
  // Plain decimals only: rejects "1e2", "0x10" and thousands separators.
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(text)) return "invalid";
  return Number(text.replace(",", "."));
};

export type ParsePastWorkoutResult =
  | { readonly ok: true; readonly pending: PastWorkoutPending }
  | { readonly ok: false; readonly message: string };
type BuildResult =
  | { readonly ok: true; readonly request: PastWorkoutRequest }
  | { readonly ok: false; readonly message: string };

/** Validate the form and freeze its operation id and instants for every retry. */
export function parsePastWorkoutForm(
  form: PastWorkoutForm,
  operationId: string,
  now: Date = new Date(),
): ParsePastWorkoutResult {
  const startedAt = localInstant(form.date, form.startTime);
  if (!startedAt)
    return {
      ok: false,
      message: "Choose a valid date and start time.",
    };
  const minutesText = form.durationMinutes.trim();
  const minutes = Number(minutesText);
  if (
    !/^\d+$/.test(minutesText) ||
    minutes < 1 ||
    minutes > MAX_PAST_WORKOUT_MINUTES
  )
    return {
      ok: false,
      message: `Enter a duration from 1 to ${MAX_PAST_WORKOUT_MINUTES} minutes.`,
    };
  const completedAt = new Date(startedAt.getTime() + minutes * 60_000);
  if (completedAt.getTime() > now.getTime())
    return {
      ok: false,
      message:
        "This workout would end in the future. Check the date, start time and duration.",
    };
  const pending: PastWorkoutPending = {
    operationId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    workoutId: null,
  };
  const built = buildPastWorkoutRequest(form, pending);
  return built.ok ? { ok: true, pending } : built;
}

/** Deterministic request bodies for a pending save. */
export function buildPastWorkoutRequest(
  form: PastWorkoutForm,
  pending: PastWorkoutPending,
): BuildResult {
  const { operationId } = pending;
  const exercises = form.exercises.filter((e) => e.sets.length > 0);
  if (exercises.length === 0)
    return { ok: false, message: "Add at least one exercise with a set." };
  const setCount = exercises.reduce((n, e) => n + e.sets.length, 0);
  if (setCount > MAX_PAST_WORKOUT_SETS)
    return {
      ok: false,
      message: `A past workout can have up to ${MAX_PAST_WORKOUT_SETS} sets.`,
    };

  const completedIso = pending.completedAt;
  const sets: (WorkoutSetCreate & { sequence: number })[] = [];
  for (const exercise of exercises) {
    for (const [index, input] of exercise.sets.entries()) {
      const label = `${exercise.name} set ${index + 1}`;
      const reps = parseOptional(input.reps);
      const load = parseOptional(input.load);
      if (reps === "invalid" || load === "invalid")
        return {
          ok: false,
          message: `${label}: use non-negative numbers for reps and weight.`,
        };
      if (reps !== null && !Number.isInteger(reps))
        return { ok: false, message: `${label}: reps must be a whole number.` };
      if (reps === null && load === null)
        return {
          ok: false,
          message: `${label}: enter reps or weight, or remove the set.`,
        };
      const parsed = workoutSetCreateSchema.safeParse({
        exerciseId: exercise.exerciseId,
        sequence: sets.length + 1,
        setType: input.setType,
        ...(reps !== null ? { repetitions: reps } : {}),
        ...(load !== null
          ? { loadKg: displayWeightToKilograms(load, form.unitSystem) }
          : {}),
        completedAt: completedIso,
      });
      if (!parsed.success)
        return { ok: false, message: `${label}: check reps and weight.` };
      sets.push({ ...parsed.data, sequence: sets.length + 1 });
    }
  }

  const notes = form.notes.trim();
  const workout = workoutCreateSchema.safeParse({
    clientOperationId: operationId,
    name: form.name.trim() || "Workout",
    startedAt: pending.startedAt,
    completedAt: completedIso,
    ...(notes ? { notes } : {}),
    details: withWorkoutLifecycle(
      {
        sessionMode: "one_time",
        entryMode: PAST_WORKOUT_ENTRY_MODE,
        sessionExercises: exercises.map((e) => ({
          name: e.name,
          ...(e.catalogId ? { catalogId: e.catalogId } : {}),
          restSeconds: 90,
        })),
      },
      { kind: "session" },
    ),
  });
  if (!workout.success)
    return { ok: false, message: "Check the workout name and notes." };
  return {
    ok: true,
    request: {
      workout: { ...workout.data, clientOperationId: operationId },
      sets,
    },
  };
}

const explain = (error: ApiError, action: string): string => {
  switch (error.kind) {
    case "network_error":
      return `Network unavailable. ${action} when you're online. Your workout is kept on this device.`;
    case "session_expired":
      return "Your session expired. Sign in again; your workout is kept on this device.";
    case "no_session":
      return "You're signed out. Sign in and try again.";
    case "context_changed":
      return "Your account changed. Your workout is kept for the original account.";
    case "http_error":
      if (error.status === 409)
        return action === "Save the workout"
          ? "This workout was already saved with different details. Check your history, then edit or discard this draft."
          : "A set could not be saved. Retry, or tap Edit workout if it keeps failing.";
      if (error.status === 422)
        return "The server rejected these values. Tap Edit workout to change them.";
      return `The server could not ${action.toLowerCase()}. Try again.`;
    default:
      return `Could not ${action.toLowerCase()}. Try again.`;
  }
};

export type SendPastWorkoutResult =
  | { readonly ok: true; readonly workoutId: string }
  | {
      readonly ok: false;
      readonly message: string;
      /** The draft to keep showing, e.g. with a confirmed workout id. */
      readonly draft: PastWorkoutDraft;
    };

/**
 * Resumable save. The workout create is idempotent by operation id; sets are
 * reconciled by sequence against what the server already holds, so a lost
 * response or app restart never duplicates a workout or a set.
 */
export async function sendPastWorkout(
  userId: string,
  draft: PastWorkoutDraft,
  client: ApiClient,
  isCurrent: () => boolean,
  store: PastWorkoutDraftStore = pastWorkoutDraftStore,
): Promise<SendPastWorkoutResult> {
  const fail = (message: string, kept: PastWorkoutDraft = draft) => ({
    ok: false as const,
    message,
    draft: kept,
  });
  const pending = draft.pending;
  if (!pending) return fail("Nothing to save.");
  const built = buildPastWorkoutRequest(draft.form, pending);
  if (!built.ok) return fail(built.message);
  const { workout, sets } = built.request;
  if (!isCurrent()) return fail("Your account changed. Reopen this workout.");
  if (!(await store.save(userId, draft)))
    return fail(
      "Could not keep this workout on the device. Nothing was sent. Try again.",
    );
  if (!isCurrent()) return fail("Your account changed. Your draft is kept.");

  let current = draft;
  let workoutId = pending.workoutId;
  if (workoutId === null) {
    const created = await client.request<WorkoutResponse>({
      method: "POST",
      path: "/v1/workouts",
      body: workout,
      schema: workoutResponseSchema,
    });
    if (!isCurrent()) return fail("Your account changed. Your draft is kept.");
    if (!created.ok) return fail(explain(created.error, "Save the workout"));
    if (created.value.workout.completedAt === null)
      return fail("The server did not record this workout as completed.");
    workoutId = created.value.workout.id;
    current = { ...draft, pending: { ...pending, workoutId } };
    // Best effort: a replay with the same operation id finds the same workout.
    await store.save(userId, current);
  }

  const listed = await client.request<WorkoutSetListResponse>({
    method: "GET",
    path: `/v1/workouts/${encodeURIComponent(workoutId)}/sets`,
    schema: workoutSetListResponseSchema,
  });
  if (!isCurrent()) return fail("Your account changed. Your draft is kept.");
  if (!listed.ok) {
    if (listed.error.kind === "http_error" && listed.error.status === 404) {
      const reset = { ...current, pending: { ...pending, workoutId: null } };
      await store.save(userId, reset);
      return fail(
        "The partly saved workout was removed. Tap Retry to save it again.",
        reset,
      );
    }
    return fail(explain(listed.error, "Save the sets"), current);
  }
  const existing = new Map(
    listed.value.workoutSets.map((s) => [s.sequence, s] as const),
  );
  for (const set of sets) {
    const stored = existing.get(set.sequence);
    if (stored) {
      if (stored.exerciseId !== set.exerciseId)
        return fail(
          "This workout changed on another device. Review it in your history.",
          current,
        );
      continue;
    }
    const saved = await client.request<WorkoutSetResponse>({
      method: "POST",
      path: `/v1/workouts/${encodeURIComponent(workoutId)}/sets`,
      body: set,
      schema: workoutSetResponseSchema,
    });
    if (!isCurrent()) return fail("Your account changed. Your draft is kept.");
    if (!saved.ok)
      return fail(
        `${explain(saved.error, "Save the sets")} Sets already saved are kept.`,
        current,
      );
  }
  await store.clear(userId);
  return { ok: true, workoutId };
}

export type ReleasePendingResult =
  | { readonly ok: true; readonly draft: PastWorkoutDraft | null }
  | {
      readonly ok: false;
      readonly message: string;
      /** The latest draft, e.g. with a workout id learned during release. */
      readonly draft: PastWorkoutDraft;
      /**
       * The server state can't be settled from here (offline, unknown
       * rejection, or already changed in history), and no workout id is
       * confirmed: the caller may offer a warned device-only release.
       */
      readonly localRelease: boolean;
    };

/** "edit" keeps the form for changes; "discard" removes it. */
const releaseLocally = async (
  userId: string,
  draft: PastWorkoutDraft,
  mode: "edit" | "discard",
  store: PastWorkoutDraftStore,
): Promise<ReleasePendingResult> => {
  const failed = (message: string) => ({
    ok: false as const,
    message,
    draft,
    localRelease: false,
  });
  if (mode === "edit") {
    const editable: PastWorkoutDraft = { ...draft, pending: null };
    return (await store.save(userId, editable))
      ? { ok: true, draft: editable }
      : failed("Could not update the draft on this device. Try again.");
  }
  return (await store.clear(userId))
    ? { ok: true, draft: null }
    : failed("Could not discard the draft. Try again.");
};

const UNCONFIRMED =
  "This save couldn't be confirmed. If it reached the server, the workout is in your history and you can delete it there.";

/**
 * Leaving a pending save (to edit or discard) first removes whatever reached
 * the server, so an edited resave cannot leave a duplicate behind. When the
 * workout id is unknown (lost response), the idempotent create is replayed to
 * learn it, and the learned id is kept before deletion is attempted.
 */
export async function releasePendingPastWorkout(
  userId: string,
  draft: PastWorkoutDraft,
  mode: "edit" | "discard",
  client: ApiClient,
  isCurrent: () => boolean,
  store: PastWorkoutDraftStore = pastWorkoutDraftStore,
): Promise<ReleasePendingResult> {
  let current = draft;
  const stop = (message: string, localRelease: boolean) => ({
    ok: false as const,
    message,
    draft: current,
    localRelease,
  });
  const changed = () => stop("Your account changed.", false);
  const pending = draft.pending;
  if (pending) {
    let workoutId = pending.workoutId;
    if (workoutId === null) {
      const built = buildPastWorkoutRequest(draft.form, pending);
      if (!built.ok) return stop(UNCONFIRMED, true);
      const replay = await client.request<WorkoutResponse>({
        method: "POST",
        path: "/v1/workouts",
        body: built.request.workout,
        schema: workoutResponseSchema,
      });
      if (!isCurrent()) return changed();
      if (!replay.ok) {
        const e = replay.error;
        if (e.kind === "network_error")
          return stop(
            "You're offline, so this save can't be checked. If it already reached the server, the workout is in your history and you can delete it there; saving again could add a second copy.",
            true,
          );
        if (e.kind === "http_error" && e.status === 409)
          return stop(
            mode === "edit"
              ? "This workout is already in your history, with changes made there. That copy is kept, so saving again adds a second workout."
              : "This workout is already in your history, with changes made there. That copy is kept.",
            true,
          );
        if (e.kind === "http_error" && [400, 422].includes(e.status))
          return stop(UNCONFIRMED, true);
        return stop(explain(e, "Remove the saved part of this workout"), false);
      }
      workoutId = replay.value.workout.id;
      current = { ...draft, pending: { ...pending, workoutId } };
      // A failed delete below must not be followed by a device-only release.
      await store.save(userId, current);
    }
    const removed = await client.request<void>({
      method: "DELETE",
      path: `/v1/workouts/${encodeURIComponent(workoutId)}`,
    });
    if (!isCurrent()) return changed();
    if (
      !removed.ok &&
      !(removed.error.kind === "http_error" && removed.error.status === 404)
    )
      return stop(
        explain(removed.error, "Remove the saved part of this workout"),
        false,
      );
  }
  return releaseLocally(userId, current, mode, store);
}

/**
 * Warned escape hatch: release the pending save on this device only. Refused
 * once a workout id is confirmed, because that workout must be deleted first.
 */
export async function releasePendingPastWorkoutLocally(
  userId: string,
  draft: PastWorkoutDraft,
  mode: "edit" | "discard",
  store: PastWorkoutDraftStore = pastWorkoutDraftStore,
): Promise<ReleasePendingResult> {
  if (draft.pending?.workoutId)
    return {
      ok: false,
      message:
        "Part of this workout is already saved. Go online to remove it first.",
      draft,
      localRelease: false,
    };
  return releaseLocally(userId, draft, mode, store);
}
