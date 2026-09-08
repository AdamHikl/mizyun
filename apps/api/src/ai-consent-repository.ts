import { CURRENT_AI_CONSENT_VERSION } from "@mizyun/contracts";
import type {
  AiConsentRepository,
  StoredAiConsent,
  UserId,
} from "@mizyun/core";

export interface InMemoryAiConsentRepositoryOptions {
  readonly clock?: { readonly now: () => Date };
  readonly defaultGranted?: boolean;
}

export class InMemoryAiConsentRepository implements AiConsentRepository {
  readonly #byUser = new Map<UserId, StoredAiConsent>();
  readonly #clock: { readonly now: () => Date };
  readonly #defaultGranted: boolean;

  constructor(options: InMemoryAiConsentRepositoryOptions = {}) {
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#defaultGranted = options.defaultGranted ?? false;
  }

  async getConsent(
    userId: UserId,
    _options?: { readonly accessToken?: string },
  ): Promise<StoredAiConsent | null> {
    const existing = this.#byUser.get(userId);
    if (existing !== undefined) {
      return existing;
    }
    if (this.#defaultGranted) {
      const now = this.#clock.now();
      return {
        userId,
        granted: true,
        confirmedAdult: true,
        consentVersion: CURRENT_AI_CONSENT_VERSION,
        consentedAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    }
    return null;
  }

  async saveConsent(
    userId: UserId,
    consent: {
      readonly granted: boolean;
      readonly confirmedAdult: boolean;
      readonly consentVersion: string;
    },
    options?: { readonly accessToken?: string; readonly now?: Date },
  ): Promise<StoredAiConsent> {
    const now = options?.now ?? this.#clock.now();
    const existing = this.#byUser.get(userId);
    const stored: StoredAiConsent = {
      userId,
      granted: consent.granted,
      confirmedAdult: consent.confirmedAdult,
      consentVersion: consent.consentVersion,
      consentedAt: consent.granted ? (existing?.consentedAt ?? now) : null,
      revokedAt: consent.granted ? null : now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.#byUser.set(userId, stored);
    return stored;
  }
}
