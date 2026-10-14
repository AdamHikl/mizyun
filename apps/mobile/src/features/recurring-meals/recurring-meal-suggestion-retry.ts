import {
  recurringMealSuggestionAcceptSchema,
  recurringMealSuggestionAcceptResponseSchema,
  type RecurringMealSuggestionAccept,
  type RecurringMealSuggestionAcceptResponse,
} from "@mizyun/contracts";
import { createOperationId } from "@/features/log-meal/public-data";

export interface SuggestionSecureStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync(key: string): Promise<unknown>;
}
export interface RecurringSuggestionAttempt {
  readonly owner: string;
  readonly input: RecurringMealSuggestionAccept;
  readonly completed: RecurringMealSuggestionAcceptResponse | null;
  readonly savedAt: number;
}
interface Generation {
  readonly id: string;
  readonly count: number;
}
interface Journal {
  readonly previous: Generation | null;
  readonly next: Generation;
}
interface Cleanup {
  readonly generation: Generation;
  // Account erasure must also handle an unreadable payload.
  readonly operationId: string | null;
}
const queues = new Map<string, Promise<unknown>>();
const erased = new Set<string>();
export const recurringSuggestionRetryKey = (owner: string): string => {
  if (!owner || !/^[A-Za-z0-9_-]{1,128}$/.test(owner))
    throw new Error("Invalid recovery owner");
  return `mizyun.recurring-suggestion-retry.${owner}`;
};
function serialized<T>(owner: string, action: () => Promise<T>): Promise<T> {
  const pending = (queues.get(owner) ?? Promise.resolve())
    .catch(() => {})
    .then(action);
  queues.set(owner, pending);
  void pending.then(
    () => {
      if (queues.get(owner) === pending) queues.delete(owner);
    },
    () => {
      if (queues.get(owner) === pending) queues.delete(owner);
    },
  );
  return pending;
}
function generation(value: unknown): Generation {
  if (!value || typeof value !== "object")
    throw new Error("Invalid recovery manifest");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== 2 ||
    typeof row.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(row.id) ||
    !Number.isInteger(row.count) ||
    Number(row.count) < 1 ||
    Number(row.count) > 64
  )
    throw new Error("Invalid recovery manifest");
  return { id: row.id, count: Number(row.count) };
}
function parseAttempt(raw: string, owner: string): RecurringSuggestionAttempt {
  const row = JSON.parse(raw) as RecurringSuggestionAttempt;
  const input = recurringMealSuggestionAcceptSchema.parse(row.input);
  if (row.owner !== owner || !Number.isFinite(row.savedAt))
    throw new Error("Recovery owner mismatch");
  const completed =
    row.completed === null
      ? null
      : recurringMealSuggestionAcceptResponseSchema.parse(row.completed);
  if (completed && completed.recurringMeal.userId !== owner)
    throw new Error("Recovery result owner mismatch");
  return { owner, input, completed, savedAt: row.savedAt };
}
/** Journals every chunk before writing; failures remain recoverable and erasable. */
export class RecurringSuggestionRetryStore {
  constructor(readonly primitive: SuggestionSecureStore) {}
  private async cleanup(base: string): Promise<Cleanup | null> {
    const raw = await this.primitive.getItemAsync(`${base}.cleanup`);
    if (raw === null) return null;
    const row = JSON.parse(raw) as Record<string, unknown>;
    if (!row || typeof row !== "object" || Object.keys(row).length !== 2)
      throw new Error("Invalid recovery cleanup");
    return {
      generation: generation(row.generation),
      operationId:
        row.operationId === null
          ? null
          : recurringMealSuggestionAcceptSchema.shape.operationId.parse(
              row.operationId,
            ),
    };
  }
  private async manifest(base: string): Promise<Generation | null> {
    const raw = await this.primitive.getItemAsync(`${base}.manifest`);
    return raw === null ? null : generation(JSON.parse(raw));
  }
  private async removeChunks(base: string, item: Generation): Promise<void> {
    const results = await Promise.allSettled(
      Array.from({ length: item.count }, (_, i) =>
        this.primitive.deleteItemAsync(`${base}.${item.id}.${i}`),
      ),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Recovery cleanup incomplete");
  }
  private async repairWrite(base: string): Promise<void> {
    const raw = await this.primitive.getItemAsync(`${base}.journal`);
    if (raw === null) return;
    const row = JSON.parse(raw) as Journal;
    const journal: Journal = {
      previous: row.previous === null ? null : generation(row.previous),
      next: generation(row.next),
    };
    const committed = await this.manifest(base);
    for (const item of [journal.previous, journal.next]) {
      if (item && item.id !== committed?.id)
        await this.removeChunks(base, item);
    }
    await this.primitive.deleteItemAsync(`${base}.journal`);
  }
  private async repair(base: string): Promise<void> {
    await this.repairWrite(base);
    const cleanup = await this.cleanup(base);
    if (!cleanup) return;
    const committed = await this.manifest(base);
    // Never let a stale marker erase a different committed generation.
    if (committed && committed.id !== cleanup.generation.id)
      throw new Error("Recovery changed");
    await this.removeChunks(base, cleanup.generation);
    await this.primitive.deleteItemAsync(`${base}.manifest`);
    await this.primitive.deleteItemAsync(`${base}.cleanup`);
  }
  private async read(
    owner: string,
  ): Promise<RecurringSuggestionAttempt | null> {
    const base = recurringSuggestionRetryKey(owner);
    await this.repair(base);
    const item = await this.manifest(base);
    if (!item) return null;
    const chunks = await Promise.all(
      Array.from({ length: item.count }, (_, i) =>
        this.primitive.getItemAsync(`${base}.${item.id}.${i}`),
      ),
    );
    if (chunks.some((chunk) => chunk === null))
      throw new Error("Recovery payload incomplete");
    return parseAttempt(chunks.join(""), owner);
  }
  private async write(
    owner: string,
    value: RecurringSuggestionAttempt,
  ): Promise<void> {
    if (erased.has(owner)) throw new Error("Account recovery retired");
    const canonical = parseAttempt(JSON.stringify(value), owner);
    const characters = Array.from(JSON.stringify(canonical));
    if (characters.length > 25_600)
      throw new Error("Recovery payload too large");
    const chunks: string[] = [];
    // 400 code points fit historical native item limits, including non-ASCII names.
    for (let i = 0; i < characters.length; i += 400)
      chunks.push(characters.slice(i, i + 400).join(""));
    const base = recurringSuggestionRetryKey(owner);
    await this.repair(base);
    const next: Generation = { id: createOperationId(), count: chunks.length };
    await this.primitive.setItemAsync(
      `${base}.journal`,
      JSON.stringify({ previous: await this.manifest(base), next }),
    );
    try {
      for (let i = 0; i < chunks.length; i++)
        await this.primitive.setItemAsync(
          `${base}.${next.id}.${i}`,
          chunks[i]!,
        );
      await this.primitive.setItemAsync(
        `${base}.manifest`,
        JSON.stringify(next),
      );
    } catch (cause) {
      await this.repair(base);
      throw cause;
    }
    await this.repair(base);
  }
  load(owner: string): Promise<RecurringSuggestionAttempt | null> {
    return serialized(owner, () => this.read(owner));
  }
  prepare(
    owner: string,
    input: RecurringMealSuggestionAccept,
    isCurrent: () => boolean,
  ): Promise<RecurringSuggestionAttempt> {
    return serialized(owner, async () => {
      if (!isCurrent() || erased.has(owner))
        throw new Error("Recovery owner retired");
      const existing = await this.read(owner);
      if (existing) {
        if (
          JSON.stringify(existing.input) !==
          JSON.stringify(recurringMealSuggestionAcceptSchema.parse(input))
        )
          throw new Error("Resolve the previous setup before starting another");
        return existing;
      }
      const value = {
        owner,
        input: recurringMealSuggestionAcceptSchema.parse(input),
        completed: null,
        savedAt: Date.now(),
      };
      await this.write(owner, value);
      if (!isCurrent()) throw new Error("Recovery owner retired");
      return value;
    });
  }
  complete(
    owner: string,
    input: RecurringMealSuggestionAccept,
    result: RecurringMealSuggestionAcceptResponse,
  ): Promise<void> {
    return serialized(owner, async () => {
      const existing = await this.read(owner);
      if (!existing || JSON.stringify(existing.input) !== JSON.stringify(input))
        throw new Error("Recovery changed");
      await this.write(owner, {
        ...existing,
        completed: result,
        savedAt: Date.now(),
      });
    });
  }
  clear(owner: string, expectedOperationId?: string): Promise<void> {
    return serialized(owner, async () => {
      const base = recurringSuggestionRetryKey(owner);
      const cleanup = await this.cleanup(base);
      if (
        expectedOperationId &&
        cleanup &&
        cleanup.operationId !== expectedOperationId
      )
        throw new Error("Recovery changed");
      await this.repair(base);
      const item = await this.manifest(base);
      // Clearing an already-cleared operation is idempotent.
      if (!item) return;
      if (expectedOperationId) {
        const existing = await this.read(owner);
        if (existing?.input.operationId !== expectedOperationId)
          throw new Error("Recovery changed");
      }
      // Persist authorization and bounded chunk identity before deleting any
      // payload. A restart can finish cleanup without parsing removed chunks.
      await this.primitive.setItemAsync(
        `${base}.cleanup`,
        JSON.stringify({
          generation: item,
          operationId: expectedOperationId ?? null,
        } satisfies Cleanup),
      );
      await this.repair(base);
    });
  }
}
let native: Promise<RecurringSuggestionRetryStore> | undefined;
export const getRecurringSuggestionRetryStore =
  (): Promise<RecurringSuggestionRetryStore> =>
    (native ??= import("expo-secure-store").then(
      (store) => new RecurringSuggestionRetryStore(store),
    ));
export async function clearRecurringSuggestionRecovery(
  owner: string,
  store?: RecurringSuggestionRetryStore,
): Promise<void> {
  erased.add(owner);
  await (store ?? (await getRecurringSuggestionRetryStore())).clear(owner);
}
