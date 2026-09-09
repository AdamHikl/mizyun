import type { MemoryId, UserId } from "@mizyun/core";

export type MemoryKind =
  "profile" | "goal" | "preference" | "constraint" | "observation" | "summary";

/**
 * Lifecycle status of a memory item. Mirrors the SQL `check`
 * constraint in `20260714102000_conversations_and_memory.sql`.
 *
 * - `candidate`: visible in user controls but excluded from
 *   orchestrator recall until the user confirms it.
 * - `active`: surfaced in the Coach prompt and on the memories
 *   list endpoint.
 * - `superseded`: replaced by a newer memory; kept for audit,
 *   never surfaced.
 * - `deleted`: soft-delete; hard-delete cascades through
 *   `memory_provider_refs` via the SQL FK.
 */
export type MemoryStatus = "candidate" | "active" | "superseded" | "deleted";

export interface MemoryRecord {
  readonly id: MemoryId;
  readonly userId: UserId;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly source: string;
  readonly confidence: number;
  readonly importance: number;
  readonly status: MemoryStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt?: Date;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface NewMemory {
  readonly id: MemoryId;
  readonly userId: UserId;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly source: string;
  readonly confidence: number;
  readonly importance: number;
  readonly status?: MemoryStatus;
  readonly expiresAt?: Date;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MemoryQuery {
  readonly userId: UserId;
  readonly accessToken: string;
  readonly text: string;
  readonly kinds?: readonly MemoryKind[];
  readonly limit: number;
  readonly asOf: Date;
}

/**
 * Validated patch for the user-facing memory controls API.
 * Every field is optional; the validator rejects a patch that
 * touches no field at all. `content` flows through the
 * `screenCoachInput` safety screen at the route layer to defend
 * against prompt injection via the controls API.
 */
export interface MemoryPatch {
  readonly content?: string;
  readonly confidence?: number;
  readonly importance?: number;
  readonly status?: MemoryStatus;
  readonly expiresAt?: Date | null;
  /**
   * Internal provenance metadata. User-facing contracts do not
   * accept this field; the route uses it to append correction
   * history before calling the store.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MemorySaveOptions {
  readonly accessToken: string;
}

export interface MemoryGetOptions {
  readonly accessToken: string;
}

export interface MemoryListOptions {
  readonly accessToken: string;
  readonly includeSuperseded?: boolean;
  readonly limit?: number;
}

export interface MemoryUpdateOptions {
  readonly accessToken: string;
  readonly patch: MemoryPatch;
  readonly asOf?: Date;
}

export interface MemoryDeleteOptions {
  readonly accessToken: string;
}

/**
 * Thrown when a memory lookup targets an id that does not exist
 * for the principal, or the row is in a status the caller cannot
 * see. The route maps this to 404.
 */
export class MemoryNotFoundError extends Error {
  constructor(readonly memoryId: MemoryId) {
    super(`Memory ${memoryId} not found.`);
    this.name = "MemoryNotFoundError";
  }
}

/**
 * Thrown when the user-facing patch fails domain validation
 * (out-of-range confidence/importance, empty content, invalid
 * status). The route maps this to 422.
 */
export class MemoryValidationError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "MemoryValidationError";
  }
}

/**
 * Thrown when the patch touches no field. The route maps this
 * to 422 with a stable code.
 */
export class MemoryEmptyPatchError extends MemoryValidationError {
  constructor() {
    super("Memory patch must change at least one field.");
    this.name = "MemoryEmptyPatchError";
  }
}

export interface MemoryStore {
  save(memory: NewMemory, options: MemorySaveOptions): Promise<MemoryRecord>;
  search(query: MemoryQuery): Promise<readonly MemoryRecord[]>;
  /**
   * List memories for the principal. Default is `status='active'`
   * only; `includeSuperseded=true` returns the audit trail.
   */
  list(
    userId: UserId,
    options: MemoryListOptions,
  ): Promise<readonly MemoryRecord[]>;
  /**
   * Look up a single memory by id, scoped to the principal.
   * Returns `null` when no row matches.
   */
  get(
    userId: UserId,
    memoryId: MemoryId,
    options: MemoryGetOptions,
  ): Promise<MemoryRecord | null>;
  /**
   * Apply a validated patch. Throws `MemoryNotFoundError` when
   * the row does not exist for the principal; throws
   * `MemoryValidationError` for invalid input.
   */
  update(
    userId: UserId,
    memoryId: MemoryId,
    options: MemoryUpdateOptions,
  ): Promise<MemoryRecord>;
  delete(
    userId: UserId,
    memoryId: MemoryId,
    options: MemoryDeleteOptions,
  ): Promise<boolean>;
}

/**
 * Active-memory predicate per ADR-0017 §"Memory invariants":
 * `confidence >= 0.5`, `importance >= 3`, `status === "active"`,
 * `expiresAt` not in the past.
 */
export const isActiveMemory = (
  memory: Pick<
    MemoryRecord,
    "confidence" | "importance" | "status" | "expiresAt"
  >,
  asOf: Date,
): boolean =>
  memory.status === "active" &&
  memory.confidence >= 0.5 &&
  memory.importance >= 3 &&
  (memory.expiresAt === undefined ||
    memory.expiresAt.getTime() > asOf.getTime());

export const MEMORY_ACTIVE_CONFIDENCE = 0.5;
export const MEMORY_ACTIVE_IMPORTANCE = 3;
export const MEMORY_LIST_DEFAULT_LIMIT = 50;
export const MEMORY_LIST_MAX_LIMIT = 10_000;

export const validateActiveMemoryThreshold = (
  memory: Pick<MemoryRecord, "status" | "confidence" | "importance">,
): MemoryValidationError | null =>
  memory.status === "active" &&
  (memory.confidence < MEMORY_ACTIVE_CONFIDENCE ||
    memory.importance < MEMORY_ACTIVE_IMPORTANCE)
    ? new MemoryValidationError(
        `active memories require confidence >= ${MEMORY_ACTIVE_CONFIDENCE} and importance >= ${MEMORY_ACTIVE_IMPORTANCE}`,
      )
    : null;

/**
 * Validate a `MemoryPatch`. Returns the first failure or `null`
 * when the patch is valid. Empty patches are rejected.
 */
export const validateMemoryPatch = (
  patch: MemoryPatch,
): MemoryValidationError | null => {
  const touched =
    patch.content !== undefined ||
    patch.confidence !== undefined ||
    patch.importance !== undefined ||
    patch.status !== undefined;
  const touchedWithLifecycle =
    touched || patch.expiresAt !== undefined || patch.metadata !== undefined;
  if (!touchedWithLifecycle) {
    return new MemoryEmptyPatchError();
  }
  if (patch.content !== undefined && patch.content.trim().length === 0) {
    return new MemoryValidationError("content must not be blank");
  }
  if (
    patch.confidence !== undefined &&
    (patch.confidence < 0 || patch.confidence > 1)
  ) {
    return new MemoryValidationError(
      "confidence must be between 0 and 1 inclusive",
    );
  }
  if (
    patch.importance !== undefined &&
    (!Number.isInteger(patch.importance) ||
      patch.importance < 0 ||
      patch.importance > 10)
  ) {
    return new MemoryValidationError(
      "importance must be an integer between 0 and 10 inclusive",
    );
  }
  const validStatuses: readonly MemoryStatus[] = [
    "candidate",
    "active",
    "superseded",
    "deleted",
  ];
  if (patch.status !== undefined && !validStatuses.includes(patch.status)) {
    return new MemoryValidationError(
      `status must be one of: ${validStatuses.join(", ")}`,
    );
  }
  return null;
};

export class InMemoryMemoryStore implements MemoryStore {
  readonly #records = new Map<MemoryId, MemoryRecord>();

  async save(
    memory: NewMemory,
    options: MemorySaveOptions,
  ): Promise<MemoryRecord> {
    void options;
    const now = new Date();
    const existing = this.#records.get(memory.id);
    const record: MemoryRecord = {
      ...memory,
      status: memory.status ?? "candidate",
      metadata: memory.metadata ?? {},
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const activationError = validateActiveMemoryThreshold(record);
    if (activationError !== null) throw activationError;

    this.#records.set(record.id, record);
    return record;
  }

  async search(query: MemoryQuery): Promise<readonly MemoryRecord[]> {
    const words = query.text.toLocaleLowerCase().split(/\s+/).filter(Boolean);

    return [...this.#records.values()]
      .filter((memory) => memory.userId === query.userId)
      .filter((memory) => isActiveMemory(memory, query.asOf))
      .filter((memory) => !query.kinds || query.kinds.includes(memory.kind))
      .map((memory) => ({
        memory,
        score: words.filter((word) =>
          memory.content.toLocaleLowerCase().includes(word),
        ).length,
      }))
      .filter(({ score }) => score > 0 || words.length === 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.memory.importance - a.memory.importance ||
          b.memory.updatedAt.getTime() - a.memory.updatedAt.getTime(),
      )
      .slice(0, query.limit)
      .map(({ memory }) => memory);
  }

  async list(
    userId: UserId,
    options: MemoryListOptions,
  ): Promise<readonly MemoryRecord[]> {
    const limit = Math.min(
      options.limit ?? MEMORY_LIST_DEFAULT_LIMIT,
      MEMORY_LIST_MAX_LIMIT,
    );
    return [...this.#records.values()]
      .filter((memory) => memory.userId === userId)
      .filter((memory) =>
        options.includeSuperseded
          ? memory.status !== "deleted"
          : memory.status === "active",
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);
  }

  async get(
    userId: UserId,
    memoryId: MemoryId,
    options: MemoryGetOptions,
  ): Promise<MemoryRecord | null> {
    void options;
    const memory = this.#records.get(memoryId);
    if (!memory || memory.userId !== userId || memory.status === "deleted") {
      return null;
    }
    return memory;
  }

  async update(
    userId: UserId,
    memoryId: MemoryId,
    options: MemoryUpdateOptions,
  ): Promise<MemoryRecord> {
    const validationError = validateMemoryPatch(options.patch);
    if (validationError !== null) {
      throw validationError;
    }
    const memory = this.#records.get(memoryId);
    if (!memory || memory.userId !== userId || memory.status === "deleted") {
      throw new MemoryNotFoundError(memoryId);
    }
    const candidate: MemoryRecord = {
      ...memory,
      ...(options.patch.content !== undefined
        ? { content: options.patch.content }
        : {}),
      ...(options.patch.confidence !== undefined
        ? { confidence: options.patch.confidence }
        : {}),
      ...(options.patch.importance !== undefined
        ? { importance: options.patch.importance }
        : {}),
      ...(options.patch.status !== undefined
        ? { status: options.patch.status }
        : {}),
      ...(options.patch.expiresAt instanceof Date
        ? { expiresAt: options.patch.expiresAt }
        : {}),
      ...(options.patch.metadata !== undefined
        ? { metadata: options.patch.metadata }
        : {}),
      updatedAt: new Date(),
    };
    const next: MemoryRecord =
      options.patch.expiresAt === null
        ? (({ expiresAt: _expiresAt, ...withoutExpiry }) => withoutExpiry)(
            candidate,
          )
        : candidate;
    const activationError = validateActiveMemoryThreshold(next);
    if (activationError !== null) throw activationError;
    this.#records.set(next.id, next);
    return next;
  }

  async delete(
    userId: UserId,
    memoryId: MemoryId,
    options: MemoryDeleteOptions,
  ): Promise<boolean> {
    void options;
    const memory = this.#records.get(memoryId);
    if (!memory || memory.userId !== userId) return false;
    this.#records.delete(memoryId);
    return true;
  }
}
