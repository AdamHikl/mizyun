import type { MemoryId, UserId } from "@mizyun/core";

export type MemoryKind =
  "profile" | "goal" | "preference" | "constraint" | "observation" | "summary";

export interface MemoryRecord {
  readonly id: MemoryId;
  readonly userId: UserId;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly source: string;
  readonly confidence: number;
  readonly importance: number;
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
  readonly expiresAt?: Date;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MemoryQuery {
  readonly userId: UserId;
  readonly text: string;
  readonly kinds?: readonly MemoryKind[];
  readonly limit: number;
  readonly asOf: Date;
}

export interface MemoryStore {
  save(memory: NewMemory): Promise<MemoryRecord>;
  search(query: MemoryQuery): Promise<readonly MemoryRecord[]>;
  list(userId: UserId, limit: number): Promise<readonly MemoryRecord[]>;
  delete(userId: UserId, memoryId: MemoryId): Promise<boolean>;
}

export class InMemoryMemoryStore implements MemoryStore {
  readonly #records = new Map<MemoryId, MemoryRecord>();

  async save(memory: NewMemory): Promise<MemoryRecord> {
    const now = new Date();
    const existing = this.#records.get(memory.id);
    const record: MemoryRecord = {
      ...memory,
      metadata: memory.metadata ?? {},
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.#records.set(record.id, record);
    return record;
  }

  async search(query: MemoryQuery): Promise<readonly MemoryRecord[]> {
    const words = query.text.toLocaleLowerCase().split(/\s+/).filter(Boolean);

    return [...this.#records.values()]
      .filter((memory) => memory.userId === query.userId)
      .filter((memory) => !memory.expiresAt || memory.expiresAt > query.asOf)
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

  async list(userId: UserId, limit: number): Promise<readonly MemoryRecord[]> {
    return [...this.#records.values()]
      .filter((memory) => memory.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);
  }

  async delete(userId: UserId, memoryId: MemoryId): Promise<boolean> {
    const memory = this.#records.get(memoryId);
    if (!memory || memory.userId !== userId) return false;
    return this.#records.delete(memoryId);
  }
}
