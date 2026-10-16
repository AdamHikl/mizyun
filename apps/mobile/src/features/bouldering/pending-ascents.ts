import type { ApiClient } from "@mizyun/api-client";
import {
  boulderAscentCreateSchema,
  boulderAscentUpdateSchema,
  type BoulderAscentCreate,
  type BoulderAscentRecord,
  type BoulderAscentUpdate,
} from "@mizyun/contracts";
import {
  clearLoggingDraft,
  loadRequiredLoggingDraft,
  updateLoggingDraft,
  type SecureKeyValueStore,
} from "@/features/logging-draft-storage";
import {
  createBoulderAscent,
  removeBoulderAscent,
  updateBoulderAscent,
  type BoulderFailure,
} from "./client";

/**
 * Pending ascent commands (ADR-0066 §4, like `run-draft.ts`): each command is
 * written to the encrypted per-account logging-draft slot BEFORE it is sent,
 * so an app kill mid-save replays the same operation id. The server receipts
 * make replay idempotent; a removed or conflicting command is dropped.
 */
export type BoulderPendingCommand =
  | {
      readonly kind: "create";
      readonly sessionId: string;
      readonly body: BoulderAscentCreate;
      readonly queuedAt: string;
    }
  | {
      readonly kind: "update";
      readonly sessionId: string;
      readonly ascentId: string;
      readonly body: BoulderAscentUpdate;
      /** A photo this edit replaces; deleted best effort after success. */
      readonly replacedPhotoAssetId: string | null;
      readonly queuedAt: string;
    }
  | {
      readonly kind: "delete";
      readonly sessionId: string;
      readonly ascentId: string;
      readonly operationId: string;
      readonly photoAssetId: string | null;
      readonly queuedAt: string;
    };

export interface BoulderPendingFinish {
  readonly sessionId: string;
  readonly clientOperationId: string;
  readonly notes: string | null;
}

export interface BoulderPendingState {
  readonly version: 1;
  readonly commands: readonly BoulderPendingCommand[];
  readonly finish: BoulderPendingFinish | null;
}

/** Bounded so the encrypted slot stays small; sync clears it quickly. */
export const MAX_PENDING_BOULDER_COMMANDS = 25;

export const EMPTY_PENDING_STATE: BoulderPendingState = {
  version: 1,
  commands: [],
  finish: null,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
const isInstant = (value: unknown): boolean =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

export const commandOperationId = (command: BoulderPendingCommand): string =>
  command.kind === "delete"
    ? command.operationId
    : command.body.clientOperationId;

const isCommand = (value: unknown): value is BoulderPendingCommand => {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  if (!isUuid(c.sessionId) || !isInstant(c.queuedAt)) return false;
  if (c.kind === "create")
    return boulderAscentCreateSchema.safeParse(c.body).success;
  if (c.kind === "update")
    return (
      isUuid(c.ascentId) &&
      (c.replacedPhotoAssetId === null || isUuid(c.replacedPhotoAssetId)) &&
      boulderAscentUpdateSchema.safeParse(c.body).success
    );
  if (c.kind === "delete")
    return (
      isUuid(c.ascentId) &&
      isUuid(c.operationId) &&
      (c.photoAssetId === null || isUuid(c.photoAssetId))
    );
  return false;
};

export const isBoulderPendingState = (
  value: unknown,
): value is BoulderPendingState => {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  if (state.version !== 1 || !Array.isArray(state.commands)) return false;
  if (state.commands.length > MAX_PENDING_BOULDER_COMMANDS) return false;
  if (!state.commands.every(isCommand)) return false;
  const finish = state.finish;
  if (finish === null) return true;
  if (!finish || typeof finish !== "object") return false;
  const f = finish as Record<string, unknown>;
  return (
    isUuid(f.sessionId) &&
    isUuid(f.clientOperationId) &&
    (f.notes === null || typeof f.notes === "string")
  );
};

export type BoulderStoreWrite =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "storage" | "full" | "account" };

export interface BoulderPendingStore {
  /** Throws when the slot cannot be read or is corrupt (never treated as empty). */
  load(userId: string): Promise<BoulderPendingState>;
  enqueue(
    userId: string,
    command: BoulderPendingCommand,
    isCurrent: () => boolean,
  ): Promise<BoulderStoreWrite>;
  remove(
    userId: string,
    operationId: string,
    isCurrent: () => boolean,
  ): Promise<boolean>;
  setFinish(
    userId: string,
    finish: BoulderPendingFinish | null,
    isCurrent: () => boolean,
  ): Promise<boolean>;
  /** Discards an unreadable slot after the user confirms. */
  discard(userId: string): Promise<boolean>;
}

const KIND = "bouldering" as const;

/** Builds a store over a secure key-value backend (SecureStore in the app). */
export const createBoulderPendingStore = (
  backend?: SecureKeyValueStore,
): BoulderPendingStore => {
  const mutate = async <T>(
    userId: string,
    isCurrent: () => boolean,
    change: (state: BoulderPendingState) => {
      result: T;
      next?: BoulderPendingState;
    },
  ): Promise<T> =>
    updateLoggingDraft<T>(
      userId,
      KIND,
      (raw) => {
        const current = raw === null ? EMPTY_PENDING_STATE : raw;
        // Never overwrite an unreadable slot: it may hold unsynced boulders.
        if (!isBoulderPendingState(current))
          throw new Error("Pending boulders are unreadable.");
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
        isBoulderPendingState,
        backend,
      );
      return state ?? EMPTY_PENDING_STATE;
    },
    async enqueue(userId, command, isCurrent) {
      if (!isCurrent()) return { ok: false, reason: "account" };
      if (!isCommand(command)) return { ok: false, reason: "storage" };
      try {
        return await mutate<BoulderStoreWrite>(userId, isCurrent, (state) => {
          const id = commandOperationId(command);
          if (state.commands.some((c) => commandOperationId(c) === id))
            return { result: { ok: true } };
          if (state.commands.length >= MAX_PENDING_BOULDER_COMMANDS)
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
              (c) => commandOperationId(c) !== operationId,
            ),
          },
        }));
      } catch {
        return false;
      }
    },
    async setFinish(userId, finish, isCurrent) {
      try {
        return await mutate(userId, isCurrent, (state) => ({
          result: true,
          next: { ...state, finish },
        }));
      } catch {
        return false;
      }
    },
    discard: (userId) => clearLoggingDraft(userId, KIND, backend),
  };
};

export const boulderPendingStore = createBoulderPendingStore();

export const enqueueFailureMessage = (
  reason: "storage" | "full" | "account",
): string =>
  reason === "full"
    ? "Too many boulders are waiting to sync. Connect to the internet, then save again."
    : reason === "account"
      ? "Your account changed. Nothing was saved."
      : "Couldn't keep this boulder on this device, so nothing was sent. Try saving again.";

export interface FlushSynced {
  readonly command: BoulderPendingCommand;
  /** Server row for create/update; null for delete. */
  readonly ascent: BoulderAscentRecord | null;
}

export interface FlushDropped {
  readonly command: BoulderPendingCommand;
  readonly failure: BoulderFailure;
}

export interface FlushOutcome {
  readonly synced: readonly FlushSynced[];
  readonly dropped: readonly FlushDropped[];
  /** Why replay stopped early (offline, disabled, account changed...), else null. */
  readonly blocked: BoulderFailure | null;
  /** Commands still waiting after this run. */
  readonly remaining: readonly BoulderPendingCommand[];
}

/** These outcomes can never succeed on retry, so the command is discarded. */
const PERMANENT = new Set(["removed", "conflict", "invalid", "not_found"]);

const send = (command: BoulderPendingCommand, client: ApiClient) =>
  command.kind === "create"
    ? createBoulderAscent(command.sessionId, command.body, client)
    : command.kind === "update"
      ? updateBoulderAscent(command.ascentId, command.body, client)
      : removeBoulderAscent(command.ascentId, client).then((result) =>
          result.ok ? { ok: true as const, value: null } : result,
        );

const inFlight = new Map<string, Promise<FlushOutcome>>();

/**
 * Replays this account's pending commands in order. Single-flight per account;
 * stops at the first retryable failure and never touches another account's slot.
 */
export function flushBoulderCommands(
  userId: string,
  options: {
    readonly client: ApiClient;
    readonly isCurrent: () => boolean;
    readonly store?: BoulderPendingStore;
    readonly onMediaOrphan?: (assetId: string) => void;
  },
): Promise<FlushOutcome> {
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
    store = boulderPendingStore,
    onMediaOrphan,
  }: {
    readonly client: ApiClient;
    readonly isCurrent: () => boolean;
    readonly store?: BoulderPendingStore;
    readonly onMediaOrphan?: (assetId: string) => void;
  },
): Promise<FlushOutcome> {
  const synced: FlushSynced[] = [];
  const dropped: FlushDropped[] = [];
  const accountChanged: BoulderFailure = {
    kind: "context_changed",
    message: "Your account changed. Reopen bouldering.",
  };
  let state: BoulderPendingState;
  try {
    state = await store.load(userId);
  } catch {
    return {
      synced,
      dropped,
      blocked: {
        kind: "unavailable",
        message:
          "Boulders saved on this device can't be read. They have not been sent.",
      },
      remaining: [],
    };
  }
  const queue = [...state.commands];
  while (queue.length > 0) {
    const command = queue[0]!;
    if (!isCurrent())
      return { synced, dropped, blocked: accountChanged, remaining: queue };
    const result = await send(command, client);
    if (!isCurrent())
      return { synced, dropped, blocked: accountChanged, remaining: queue };
    if (result.ok) {
      if (!(await store.remove(userId, commandOperationId(command), isCurrent)))
        return {
          synced,
          dropped,
          blocked: {
            kind: "unavailable",
            message: "Couldn't update boulders saved on this device.",
          },
          remaining: queue,
        };
      queue.shift();
      synced.push({ command, ascent: result.value });
      if (command.kind === "delete" && command.photoAssetId)
        onMediaOrphan?.(command.photoAssetId);
      if (
        command.kind === "update" &&
        command.replacedPhotoAssetId &&
        command.replacedPhotoAssetId !== command.body.photoAssetId
      )
        onMediaOrphan?.(command.replacedPhotoAssetId);
      continue;
    }
    if (PERMANENT.has(result.error.kind)) {
      if (!(await store.remove(userId, commandOperationId(command), isCurrent)))
        return { synced, dropped, blocked: result.error, remaining: queue };
      queue.shift();
      dropped.push({ command, failure: result.error });
      // A photo attached only by this failed edit is now unreferenced.
      if (
        command.kind === "update" &&
        command.body.photoAssetId &&
        command.body.photoAssetId !== command.replacedPhotoAssetId
      )
        onMediaOrphan?.(command.body.photoAssetId);
      continue;
    }
    return { synced, dropped, blocked: result.error, remaining: queue };
  }
  return { synced, dropped, blocked: null, remaining: [] };
}

/** Message shown for a dropped command; never silent. */
export const droppedMessage = (dropped: FlushDropped): string => {
  const what =
    dropped.command.kind === "create"
      ? "A boulder waiting to sync"
      : dropped.command.kind === "update"
        ? "A waiting edit"
        : "A waiting delete";
  switch (dropped.failure.kind) {
    case "removed":
      return `${what} was discarded because the boulder was removed.`;
    case "conflict":
      return `${what} was discarded because the boulder changed elsewhere. Showing the latest version.`;
    case "not_found":
      return `${what} was discarded because its session is no longer available.`;
    default:
      return `${what} was discarded because the server rejected it.`;
  }
};
