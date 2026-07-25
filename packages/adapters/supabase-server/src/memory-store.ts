import {
  MemoryNotFoundError,
  type MemoryKind,
  type MemoryPatch,
  type MemoryRecord,
  type MemoryStatus,
  type NewMemory,
  type MemoryDeleteOptions,
  type MemoryGetOptions,
  type MemoryListOptions,
  type MemorySearchOptions,
  type MemoryStore,
  type MemoryUpdateOptions,
} from "@mizyun/memory";
import type { MemoryId, UserId } from "@mizyun/core";

import type { RepositorySupabaseClient } from "./index.js";
import { RepositoryError } from "./repository-error.js";
import {
  MEMORY_LIST_DEFAULT_LIMIT,
  MEMORY_LIST_MAX_LIMIT,
  validateMemoryPatch,
} from "@mizyun/memory";

/**
 * SQL row shape for `public.memory_items` as Supabase returns it.
 * Snake_case columns are the SQL convention; the adapter converts
 * to camelCase `MemoryRecord` in `fromRow`.
 */
interface MemoryRow extends Record<string, unknown> {
  readonly id: string;
  readonly user_id: string;
  readonly kind: string;
  readonly content: string;
  readonly source: string;
  readonly confidence: string | number;
  readonly importance: number;
  readonly status: string;
  readonly metadata: Record<string, unknown>;
  readonly expires_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const fromRow = (row: MemoryRow): MemoryRecord => ({
  id: row.id as MemoryId,
  userId: row.user_id as UserId,
  kind: row.kind as MemoryKind,
  content: row.content,
  source: row.source,
  confidence: Number(row.confidence),
  importance: Number(row.importance),
  status: row.status as MemoryStatus,
  metadata: row.metadata,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
  ...(row.expires_at === null ? {} : { expiresAt: new Date(row.expires_at) }),
});

export interface SupabaseMemoryStoreOptions {
  readonly clientFor: (accessToken: string) => RepositorySupabaseClient;
}

export class SupabaseMemoryStore implements MemoryStore {
  readonly #clientFor: (accessToken: string) => RepositorySupabaseClient;

  constructor(options: SupabaseMemoryStoreOptions) {
    this.#clientFor = options.clientFor;
  }

  async save(memory: NewMemory): Promise<MemoryRecord> {
    const client = this.#clientFor(memory.userId);
    const payload = {
      id: memory.id,
      user_id: memory.userId,
      kind: memory.kind,
      content: memory.content,
      source: memory.source,
      confidence: memory.confidence,
      importance: memory.importance,
      status: memory.status ?? "candidate",
      metadata: memory.metadata ?? {},
      ...(memory.expiresAt === undefined
        ? {}
        : { expires_at: memory.expiresAt.toISOString() }),
    };
    const result = await client
      .from<MemoryRow>("memory_items")
      .insert(payload)
      .select("*")
      .single();
    if (result.error || result.data === null) {
      throw new RepositoryError(
        result.error?.message ?? "memory insert returned no row",
      );
    }
    return fromRow(result.data);
  }

  async search(query: {
    readonly userId: UserId;
    readonly text: string;
    readonly kinds?: readonly MemoryKind[];
    readonly limit: number;
    readonly asOf: Date;
  }): Promise<readonly MemoryRecord[]> {
    const client = this.#clientFor(query.userId);
    let builder = client
      .from<MemoryRow>("memory_items")
      .select("*")
      .eq("user_id", query.userId)
      .in("status", ["active", "candidate"])
      .order("updated_at", { ascending: false })
      .limit(query.limit);
    if (query.kinds !== undefined && query.kinds.length > 0) {
      builder = builder.in("kind", [...query.kinds]);
    }
    const result = await builder;
    if (result.error) {
      throw new RepositoryError(result.error.message);
    }
    // The InMemoryMemoryStore does a simple word-overlap scoring;
    // the SQL adapter keeps the same shape so the orchestrator's
    // recall is identical in dev and prod. Supabase full-text
    // search is out of scope for MEM-001.
    const words = query.text.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const filtered = result.data
      .map((row) => fromRow(row))
      .filter((memory) =>
        memory.expiresAt === undefined
          ? true
          : memory.expiresAt.getTime() > query.asOf.getTime(),
      )
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
    return filtered;
  }

  async list(
    userId: UserId,
    options: MemoryListOptions,
  ): Promise<readonly MemoryRecord[]> {
    const limit = Math.min(
      options.limit ?? MEMORY_LIST_DEFAULT_LIMIT,
      MEMORY_LIST_MAX_LIMIT,
    );
    const client = this.#clientFor(options.accessToken);
    const statuses = options.includeSuperseded
      ? ["active", "candidate", "superseded"]
      : ["active"];
    const result = await client
      .from<MemoryRow>("memory_items")
      .select("*")
      .eq("user_id", userId)
      .in("status", statuses)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (result.error) {
      throw new RepositoryError(result.error.message);
    }
    return result.data.map(fromRow);
  }

  async get(
    userId: UserId,
    memoryId: MemoryId,
    options: MemoryGetOptions,
  ): Promise<MemoryRecord | null> {
    const client = this.#clientFor(options.accessToken);
    const result = await client
      .from<MemoryRow>("memory_items")
      .select("*")
      .eq("user_id", userId)
      .eq("id", memoryId)
      .neq("status", "deleted")
      .maybeSingle();
    if (result.error) {
      throw new RepositoryError(result.error.message);
    }
    return result.data === null ? null : fromRow(result.data);
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
    const patch: MemoryPatch = options.patch;
    const client = this.#clientFor(options.accessToken);
    const payload: Partial<MemoryRow> = {
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.confidence !== undefined
        ? { confidence: patch.confidence }
        : {}),
      ...(patch.importance !== undefined
        ? { importance: patch.importance }
        : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    };
    const result = await client
      .from<MemoryRow>("memory_items")
      .update(payload)
      .eq("user_id", userId)
      .eq("id", memoryId)
      .neq("status", "deleted")
      .select("*")
      .maybeSingle();
    if (result.error) {
      throw new RepositoryError(result.error.message);
    }
    if (result.data === null) {
      throw new MemoryNotFoundError(memoryId);
    }
    return fromRow(result.data);
  }

  async delete(
    userId: UserId,
    memoryId: MemoryId,
    options: MemoryDeleteOptions,
  ): Promise<boolean> {
    const client = this.#clientFor(options.accessToken);
    const result = await client
      .from<MemoryRow>("memory_items")
      .delete()
      .eq("user_id", userId)
      .eq("id", memoryId)
      .select("id");
    if (result.error) {
      throw new RepositoryError(result.error.message);
    }
    return result.data.length > 0;
  }
}
