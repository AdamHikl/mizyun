import type { UserId } from "@mizyun/core";
import type { BetaProStatus } from "@mizyun/contracts";

export interface BetaProRecord {
  readonly id: string;
  readonly userId: UserId;
  readonly email: string;
  readonly pushToken: string | null;
  readonly status: BetaProStatus;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly reviewedAt: Date | null;
}

export interface BetaProRepository {
  updatePushToken(
    userId: UserId,
    pushToken: string,
    options?: { readonly accessToken?: string },
  ): Promise<boolean>;

  getRequest(
    userId: UserId,
    options?: { readonly accessToken?: string },
  ): Promise<BetaProRecord | null>;

  saveRequest(
    data: {
      readonly userId: UserId;
      readonly email: string;
      readonly pushToken?: string | null;
      readonly notes?: string | null;
    },
    options?: { readonly accessToken?: string; readonly now?: Date },
  ): Promise<BetaProRecord>;
}

export class InMemoryBetaProRepository implements BetaProRepository {
  readonly #byUser = new Map<UserId, BetaProRecord>();

  async updatePushToken(userId: UserId, pushToken: string): Promise<boolean> {
    const existing = this.#byUser.get(userId);
    if (!existing) return false;
    this.#byUser.set(userId, { ...existing, pushToken });
    return true;
  }

  async getRequest(
    userId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<BetaProRecord | null> {
    return this.#byUser.get(userId) ?? null;
  }

  async saveRequest(
    data: {
      readonly userId: UserId;
      readonly email: string;
      readonly pushToken?: string | null;
      readonly notes?: string | null;
    },
    options?: { readonly accessToken?: string; readonly now?: Date },
  ): Promise<BetaProRecord> {
    const existing = this.#byUser.get(data.userId);
    const now = options?.now ?? new Date();

    if (existing) {
      const updated: BetaProRecord = {
        ...existing,
        pushToken:
          data.pushToken !== undefined
            ? (data.pushToken ?? null)
            : existing.pushToken,
        notes:
          existing.status === "pending" && data.notes !== undefined
            ? (data.notes ?? null)
            : existing.notes,
      };
      this.#byUser.set(data.userId, updated);
      return updated;
    }

    const created: BetaProRecord = {
      id: crypto.randomUUID(),
      userId: data.userId,
      email: data.email,
      pushToken: data.pushToken ?? null,
      status: "pending",
      notes: data.notes ?? null,
      createdAt: now,
      reviewedAt: null,
    };
    this.#byUser.set(data.userId, created);
    return created;
  }

  __seedForTest(record: BetaProRecord): void {
    this.#byUser.set(record.userId, record);
  }
}
