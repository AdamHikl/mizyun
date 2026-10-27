import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  workoutSetCreateSchema,
  workoutSetResponseSchema,
  type WorkoutSet,
  type WorkoutSetCreate,
  type WorkoutSetResponse,
} from "@mizyun/contracts";
import {
  clearLoggingDraft,
  loadRequiredLoggingDraft,
  updateLoggingDraft,
  type SecureKeyValueStore,
} from "@/features/logging-draft-storage";

/**
 * Pending live-workout sets (REL-02, like `bouldering/pending-ascents.ts`):
 * each new set is written to the encrypted per-account logging-draft slot
 * BEFORE it is sent, with its client operation id, sequence and completedAt.
 * Replays reuse the same operation id, so the server returns the saved row
 * instead of adding a duplicate. The slot survives app restarts and locking.
 */
export interface PendingSetCommand {
  readonly kind: "create";
  readonly workoutId: string;
  /** Always carries `clientOperationId`, `sequence` and `completedAt`. */
  readonly body: WorkoutSetCreate & { readonly clientOperationId: string };
  readonly queuedAt: string;
}

export interface PendingSetState {
  readonly version: 1;
  readonly commands: readonly PendingSetCommand[];
}

/** Bounded so the encrypted slot stays small; sync clears it quickly. */
export const MAX_PENDING_SETS = 60;

export const EMPTY_PENDING_SETS: PendingSetState = { version: 1, commands: [] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
const isInstant = (value: unknown): boolean =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const isCommand = (value: unknown): value is PendingSetCommand => {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  if (c.kind !== "create" || !isUuid(c.workoutId) || !isInstant(c.queuedAt))
    return false;
  const body = workoutSetCreateSchema.safeParse(c.body);
  return (
    body.success &&
    isUuid(body.data.clientOperationId) &&
    body.data.sequence !== undefined &&
    typeof body.data.completedAt === "string"
  );
};

export const isPendingSetState = (value: unknown): value is PendingSetState => {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return (
    state.version === 1 &&
    Array.isArray(state.commands) &&
    state.commands.length <= MAX_PENDING_SETS &&
    state.commands.every(isCommand)
  );
};

export const pendingSetOperationId = (command: PendingSetCommand): string =>
  command.body.clientOperationId;

export type PendingSetWrite =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "storage" | "full" | "account" };

export interface PendingSetStore {
  /** Throws when the slot cannot be read or is corrupt (never treated as empty). */
  load(userId: string): Promise<PendingSetState>;
  enqueue(
    userId: string,
    command: PendingSetCommand,
    isCurrent: () => boolean,
  ): Promise<PendingSetWrite>;
  remove(
    userId: string,
    operationId: string,
    isCurrent: () => boolean,
  ): Promise<boolean>;
  /** Discards an unreadable slot after the user confirms. */
  discard(userId: string): Promise<boolean>;
}

const KIND = "workout-sets" as const;

/** Builds a store over a secure key-value backend (SecureStore in the app). */
export const createPendingSetStore = (
  backend?: SecureKeyValueStore,
): PendingSetStore => {
  const mutate = async <T>(
    userId: string,
    isCurrent: () => boolean,
    change: (state: PendingSetState) => {
      result: T;
      next?: PendingSetState;
    },
  ): Promise<T> =>
    updateLoggingDraft<T>(
      userId,
      KIND,
      (raw) => {
        const current = raw === null ? EMPTY_PENDING_SETS : raw;
        // Never overwrite an unreadable slot: it may hold unsynced sets.
        if (!isPendingSetState(current))
          throw new Error("Pending sets are unreadable.");
        const { result, next } = change(current);
        return next === undefined ? { result } : { result, value: next };
      },
      backend,
      isCurrent,
    );

  return {
    async load(userId) {
      const state = await loadRequiredLoggingDraft(
        userId,
        KIND,
        isPendingSetState,
        backend,
      );
      return state ?? EMPTY_PENDING_SETS;
    },
    async enqueue(userId, command, isCurrent) {
      if (!isCurrent()) return { ok: false, reason: "account" };
      if (!isCommand(command)) return { ok: false, reason: "storage" };
      try {
        return await mutate<PendingSetWrite>(userId, isCurrent, (state) => {
          const id = pendingSetOperationId(command);
          if (state.commands.some((c) => pendingSetOperationId(c) === id))
            return { result: { ok: true } };
          if (state.commands.length >= MAX_PENDING_SETS)
            return { result: { ok: false, reason: "full" } };
          return {
            result: { ok: true },
            next: { ...state, commands: [...state.commands, command] },
          };
        });
      } catch {
        return { ok: false, reason: isCurrent() ? "storage" : "account" };
      }
    },
    async remove(userId, operationId, isCurrent) {
      try {
        return await mutate(userId, isCurrent, (state) => ({
          result: true,
          next: {
            ...state,
            commands: state.commands.filter(
              (c) => pendingSetOperationId(c) !== operationId,
            ),
          },
        }));
      } catch {
        return false;
      }
    },
    discard: (userId) => clearLoggingDraft(userId, KIND, backend),
  };
};

export const pendingSetStore = createPendingSetStore();

export const pendingSetEnqueueMessage = (
  reason: "storage" | "full" | "account",
): string =>
  reason === "full"
    ? "Too many sets are waiting to sync. Connect to the internet, then log this set again."
    : reason === "account"
      ? "Your account changed. Nothing was saved."
      : "Couldn't keep this set on this device, so nothing was sent. Try again.";

/** Builds the durable command for a validated create body. */
export const pendingSetCommand = (
  workoutId: string,
  body: WorkoutSetCreate,
  operationId: string,
  now: Date,
): PendingSetCommand | null => {
  const parsed = workoutSetCreateSchema.safeParse({
    ...body,
    clientOperationId: operationId,
    completedAt: body.completedAt ?? now.toISOString(),
  });
  if (!parsed.success || parsed.data.sequence === undefined) return null;
  return {
    kind: "create",
    workoutId,
    body: { ...parsed.data, clientOperationId: operationId },
    queuedAt: now.toISOString(),
  };
};

/**
 * The set as the workout screen shows it while it waits. Its id is the
 * operation id until the server row replaces it.
 */
export const pendingSetRecord = (
  command: PendingSetCommand,
  userId: string,
): WorkoutSet => ({
  id: command.body.clientOperationId,
  userId,
  workoutId: command.workoutId,
  exerciseId: command.body.exerciseId,
  sequence: command.body.sequence!,
  setType: command.body.setType ?? "normal",
  repetitions: command.body.repetitions ?? null,
  loadKg: command.body.loadKg ?? null,
  durationSeconds: command.body.durationSeconds ?? null,
  distanceMeters: command.body.distanceMeters ?? null,
  perceivedExertion: command.body.perceivedExertion ?? null,
  completedAt: command.body.completedAt ?? null,
  createdAt: command.queuedAt,
});

/**
 * A server row is the saved copy of a pending set when it is the same
 * exercise logged at the same instant. Responses carry no operation id
 * (older builds parse them), and the server may move a keyed set to the next
 * free sequence, so sequence is not part of the match.
 */
export const sameSet = (row: WorkoutSet, command: PendingSetCommand): boolean =>
  row.workoutId === command.workoutId &&
  row.exerciseId === command.body.exerciseId &&
  row.completedAt !== null &&
  command.body.completedAt != null &&
  Date.parse(row.completedAt) === Date.parse(command.body.completedAt);

/**
 * Server sets plus this workout's sets still waiting on the device, in
 * sequence order. A pending set the server already has is shown once.
 */
export const mergePendingSets = (
  serverSets: readonly WorkoutSet[],
  pending: readonly PendingSetCommand[],
  workoutId: string,
  userId: string,
): WorkoutSet[] => {
  const waiting = pending
    .filter((c) => c.workoutId === workoutId)
    .filter((c) => !serverSets.some((row) => sameSet(row, c)))
    .map((c) => pendingSetRecord(c, userId));
  return [...serverSets, ...waiting].sort(
    (a, b) =>
      a.sequence - b.sequence ||
      Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
};

export interface PendingSetSynced {
  readonly command: PendingSetCommand;
  /** Null when the server saved it but its reply could not be read. */
  readonly workoutSet: WorkoutSet | null;
}

export interface PendingSetDropped {
  readonly command: PendingSetCommand;
  readonly error: ApiError;
}

export interface PendingSetFlush {
  readonly synced: readonly PendingSetSynced[];
  readonly dropped: readonly PendingSetDropped[];
  /** Why replay stopped early (offline, signed out, storage...), else null. */
  readonly blocked: ApiError | "storage" | null;
  /** Commands still waiting after this run, every workout included. */
  readonly remaining: readonly PendingSetCommand[];
}

/**
 * Only our API's own answers that can never succeed on retry discard a set:
 * the workout is gone (404 NOT_FOUND), or it rejected this exact operation
 * (409/422). A proxy's bare 404 during a deploy, network, Auth, rate-limit
 * and server failures keep it waiting.
 */
const isPermanent = (error: ApiError): boolean =>
  error.kind === "http_error" &&
  ((error.status === 404 && error.code === "NOT_FOUND") ||
    (error.status === 409 &&
      (error.code === "CONFLICT" || error.code === "VALIDATION_ERROR")) ||
    (error.status === 422 && error.code === "VALIDATION_ERROR"));

/** A server from before set retry identity rejects the unknown key. */
const isUnknownOperationKey = (error: ApiError): boolean =>
  error.kind === "http_error" &&
  error.status === 422 &&
  error.message.includes("clientOperationId");

const send = (client: ApiClient, workoutId: string, body: WorkoutSetCreate) =>
  client.request<WorkoutSetResponse>({
    method: "POST",
    path: `/v1/workouts/${encodeURIComponent(workoutId)}/sets`,
    body,
    schema: workoutSetResponseSchema,
  });

/**
 * Sends one waiting set with its operation id. An API from before set retry
 * identity rejects the key; then the same set is sent without key or
 * sequence (the server picks the next free one) rather than lost.
 */
export const sendPendingSet = async (
  client: ApiClient,
  command: PendingSetCommand,
) => {
  const result = await send(client, command.workoutId, command.body);
  if (result.ok || !isUnknownOperationKey(result.error)) return result;
  const {
    clientOperationId: _key,
    sequence: _sequence,
    ...keyless
  } = command.body;
  return send(client, command.workoutId, keyless);
};

const inFlight = new Map<string, Promise<PendingSetFlush>>();

/**
 * Replays this account's pending sets in queue order. Single-flight per
 * account; stops at the first retryable failure so later sets never overtake
 * an earlier one, and never touches another account's slot.
 */
export function flushPendingSets(
  userId: string,
  options: {
    readonly client: ApiClient;
    readonly isCurrent: () => boolean;
    readonly store?: PendingSetStore;
  },
): Promise<PendingSetFlush> {
  const running = inFlight.get(userId);
  if (running) return running;
  const task = runFlush(userId, options).finally(() => {
    if (inFlight.get(userId) === task) inFlight.delete(userId);
  });
  inFlight.set(userId, task);
  return task;
}

async function runFlush(
  userId: string,
  {
    client,
    isCurrent,
    store = pendingSetStore,
  }: {
    readonly client: ApiClient;
    readonly isCurrent: () => boolean;
    readonly store?: PendingSetStore;
  },
): Promise<PendingSetFlush> {
  const synced: PendingSetSynced[] = [];
  const dropped: PendingSetDropped[] = [];
  const accountChanged: ApiError = { kind: "context_changed" };
  let state: PendingSetState;
  try {
    state = await store.load(userId);
  } catch {
    return { synced, dropped, blocked: "storage", remaining: [] };
  }
  const queue = [...state.commands];
  while (queue.length > 0) {
    const command = queue[0]!;
    if (!isCurrent())
      return { synced, dropped, blocked: accountChanged, remaining: queue };
    const result = await sendPendingSet(client, command);
    if (!isCurrent())
      return { synced, dropped, blocked: accountChanged, remaining: queue };
    // A 200 whose reply failed the schema was saved: stop resending it.
    const savedUnread = !result.ok && result.error.kind === "validation_error";
    if (result.ok || savedUnread || isPermanent(result.error)) {
      if (
        !(await store.remove(userId, pendingSetOperationId(command), isCurrent))
      )
        return { synced, dropped, blocked: "storage", remaining: queue };
      queue.shift();
      if (result.ok)
        synced.push({ command, workoutSet: result.value.workoutSet });
      else if (savedUnread) synced.push({ command, workoutSet: null });
      else dropped.push({ command, error: result.error });
      continue;
    }
    return { synced, dropped, blocked: result.error, remaining: queue };
  }
  return { synced, dropped, blocked: null, remaining: [] };
}

/** Message shown for a discarded set; never silent. */
export const droppedSetMessage = (dropped: PendingSetDropped): string => {
  const error = dropped.error;
  if (error.kind === "http_error" && error.status === 404)
    return "A set waiting to sync was discarded because its workout no longer exists.";
  if (error.kind === "http_error" && error.status === 409)
    return "A set waiting to sync was discarded because a different set was already saved for it.";
  return "A set waiting to sync was discarded because the server rejected its values.";
};

/** Banner text for sets still on the device. */
export const pendingSetsNotice = (
  count: number,
  blocked: PendingSetFlush["blocked"],
): string | null => {
  if (count === 0)
    return blocked === "storage"
      ? "Sets saved on this device can't be read right now. They have not been sent."
      : null;
  const sets = count === 1 ? "1 set is" : `${count} sets are`;
  if (blocked === "storage")
    return `${sets} saved on this device but can't be updated right now.`;
  if (blocked?.kind === "no_session" || blocked?.kind === "session_expired")
    return `${sets} saved on this device. Sign in to sync ${count === 1 ? "it" : "them"}.`;
  return `${sets} saved on this device and will sync when you're back online.`;
};
