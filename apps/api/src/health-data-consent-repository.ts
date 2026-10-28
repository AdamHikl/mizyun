import type {
  HealthDataConsentRepository,
  StoredHealthDataConsent,
  UserId,
} from "@mizyun/core";

export interface InMemoryHealthDataConsentRepositoryOptions {
  readonly clock?: { readonly now: () => Date };
}

export class InMemoryHealthDataConsentRepository implements HealthDataConsentRepository {
  readonly #byUser = new Map<UserId, StoredHealthDataConsent>();
  readonly #clock: { readonly now: () => Date };

  constructor(options: InMemoryHealthDataConsentRepositoryOptions = {}) {
    this.#clock = options.clock ?? { now: () => new Date() };
  }

  async getConsent(userId: UserId): Promise<StoredHealthDataConsent | null> {
    return this.#byUser.get(userId) ?? null;
  }

  async saveConsent(
    userId: UserId,
    consent: { readonly granted: boolean; readonly consentVersion: string },
    options?: { readonly accessToken?: string; readonly now?: Date },
  ): Promise<StoredHealthDataConsent> {
    const now = options?.now ?? this.#clock.now();
    const existing = this.#byUser.get(userId);
    // Mirrors the database trigger: repeating the same answer keeps its time.
    const sameGrant =
      existing?.granted === true &&
      consent.granted &&
      existing.consentVersion === consent.consentVersion;
    const stored: StoredHealthDataConsent = {
      userId,
      granted: consent.granted,
      consentVersion: consent.consentVersion,
      consentedAt: consent.granted
        ? sameGrant
          ? existing.consentedAt
          : now
        : null,
      revokedAt: consent.granted
        ? null
        : existing?.granted === false
          ? existing.revokedAt
          : now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.#byUser.set(userId, stored);
    return stored;
  }
}
