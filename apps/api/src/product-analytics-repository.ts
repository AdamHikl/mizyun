import crypto from "node:crypto";
import type {
  ProductAnalyticsRepository,
  StoredProductAnalyticsConsent,
  StoredProductAnalyticsEvent,
  UserId,
} from "@mizyun/core";

export interface InMemoryProductAnalyticsRepositoryOptions {
  readonly clock?: { readonly now: () => Date };
}

export class InMemoryProductAnalyticsRepository implements ProductAnalyticsRepository {
  readonly #clock: { readonly now: () => Date };
  readonly #consents = new Map<string, StoredProductAnalyticsConsent>();
  readonly #events: StoredProductAnalyticsEvent[] = [];

  constructor(options: InMemoryProductAnalyticsRepositoryOptions = {}) {
    this.#clock = options.clock ?? { now: () => new Date() };
  }

  async getConsent(
    userId: UserId,
  ): Promise<StoredProductAnalyticsConsent | null> {
    return this.#consents.get(userId) ?? null;
  }

  async updateConsent(
    userId: UserId,
    mutation: {
      readonly version: string;
      readonly granted: boolean;
      readonly expectedRevision: number;
    },
  ): Promise<
    | {
        readonly success: true;
        readonly consent: StoredProductAnalyticsConsent;
      }
    | {
        readonly success: false;
        readonly error: "revision_mismatch";
        readonly current: StoredProductAnalyticsConsent | null;
      }
  > {
    const existing = this.#consents.get(userId);
    const now = this.#clock.now();

    if (existing) {
      if (existing.revision !== mutation.expectedRevision) {
        return {
          success: false,
          error: "revision_mismatch",
          current: existing,
        };
      }

      const nextRevision = existing.revision + 1;
      const nextEpoch = mutation.granted ? existing.epoch : crypto.randomUUID();
      const consentedAt = mutation.granted
        ? (existing.consentedAt ?? now)
        : existing.consentedAt;
      const revokedAt = mutation.granted ? null : now;

      if (!mutation.granted) {
        for (let i = this.#events.length - 1; i >= 0; i--) {
          if (this.#events[i]!.userId === userId) {
            this.#events.splice(i, 1);
          }
        }
      }

      const updated: StoredProductAnalyticsConsent = {
        userId,
        version: mutation.version,
        granted: mutation.granted,
        revision: nextRevision,
        epoch: nextEpoch,
        consentedAt,
        revokedAt,
        createdAt: existing.createdAt,
        updatedAt: now,
      };

      this.#consents.set(userId, updated);
      return { success: true, consent: updated };
    }

    if (mutation.expectedRevision !== 0) {
      return {
        success: false,
        error: "revision_mismatch",
        current: null,
      };
    }

    const created: StoredProductAnalyticsConsent = {
      userId,
      version: mutation.version,
      granted: mutation.granted,
      revision: 1,
      epoch: crypto.randomUUID(),
      consentedAt: mutation.granted ? now : null,
      revokedAt: mutation.granted ? null : now,
      createdAt: now,
      updatedAt: now,
    };

    this.#consents.set(userId, created);
    return { success: true, consent: created };
  }

  async recordBatch(
    userId: UserId,
    batch: {
      readonly consentVersion: string;
      readonly epoch: string;
      readonly events: ReadonlyArray<
        Omit<StoredProductAnalyticsEvent, "userId" | "receivedAt">
      >;
    },
  ): Promise<
    | {
        readonly success: true;
        readonly acceptedIds: readonly string[];
        readonly rejectedCount: number;
      }
    | { readonly success: false; readonly error: "consent_or_epoch_mismatch" }
  > {
    const consent = this.#consents.get(userId);
    if (
      !consent ||
      !consent.granted ||
      consent.epoch !== batch.epoch ||
      consent.version !== batch.consentVersion
    ) {
      return { success: false, error: "consent_or_epoch_mismatch" };
    }

    const now = this.#clock.now();
    const acceptedIds: string[] = [];

    for (const ev of batch.events) {
      const exists = this.#events.some(
        (e) => e.userId === userId && e.id === ev.id,
      );
      if (!exists) {
        this.#events.push({
          ...ev,
          userId,
          receivedAt: now,
        });
      }
      acceptedIds.push(ev.id);
    }

    return {
      success: true,
      acceptedIds,
      rejectedCount: 0,
    };
  }

  async clearEvents(
    userId: UserId,
    options: { readonly expectedRevision: number },
  ): Promise<
    | {
        readonly success: true;
        readonly cleared: true;
        readonly newEpoch: string;
        readonly revision: number;
      }
    | { readonly success: false; readonly error: "revision_mismatch" }
  > {
    const existing = this.#consents.get(userId);
    if (!existing || existing.revision !== options.expectedRevision) {
      return { success: false, error: "revision_mismatch" };
    }

    const now = this.#clock.now();
    const nextRevision = existing.revision + 1;
    const newEpoch = crypto.randomUUID();

    this.#consents.set(userId, {
      ...existing,
      epoch: newEpoch,
      revision: nextRevision,
      updatedAt: now,
    });

    for (let i = this.#events.length - 1; i >= 0; i--) {
      if (this.#events[i]!.userId === userId) {
        this.#events.splice(i, 1);
      }
    }

    return {
      success: true,
      cleared: true,
      newEpoch,
      revision: nextRevision,
    };
  }

  async listRetainedEvents(
    userId: UserId,
    options?: { readonly limit?: number },
  ): Promise<ReadonlyArray<StoredProductAnalyticsEvent>> {
    const limit = options?.limit ?? 500;
    const cutoff = new Date(
      this.#clock.now().getTime() - 30 * 24 * 60 * 60 * 1000,
    );
    return this.#events
      .filter((e) => e.userId === userId && e.recordedAt >= cutoff)
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
      .slice(0, limit);
  }

  async cleanupExpired(retentionDays = 30): Promise<number> {
    const cutoff = new Date(
      this.#clock.now().getTime() - retentionDays * 24 * 60 * 60 * 1000,
    );
    let deletedCount = 0;
    for (let i = this.#events.length - 1; i >= 0; i--) {
      if (this.#events[i]!.recordedAt < cutoff) {
        this.#events.splice(i, 1);
        deletedCount++;
      }
    }
    return deletedCount;
  }

  async deleteForUser(userId: UserId): Promise<void> {
    this.#consents.delete(userId);
    for (let i = this.#events.length - 1; i >= 0; i--) {
      if (this.#events[i]!.userId === userId) {
        this.#events.splice(i, 1);
      }
    }
  }
}
