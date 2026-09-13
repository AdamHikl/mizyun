import type { UserId } from "./index.js";

export interface StoredProductAnalyticsConsent {
  readonly userId: UserId;
  readonly version: string;
  readonly granted: boolean;
  readonly revision: number;
  readonly epoch: string;
  readonly consentedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StoredProductAnalyticsEvent {
  readonly id: string;
  readonly userId: UserId;
  readonly epoch: string;
  readonly version: string;
  readonly name: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly flowId?: string | null;
  readonly platform: "ios" | "android";
  readonly appVersion: string;
  readonly build?: string | null;
  readonly properties: Record<string, unknown>;
  readonly recordedAt: Date;
  readonly receivedAt: Date;
}

export interface ProductAnalyticsRepository {
  getConsent(
    userId: UserId,
    options?: { readonly accessToken?: string },
  ): Promise<StoredProductAnalyticsConsent | null>;
  updateConsent(
    userId: UserId,
    mutation: {
      readonly version: string;
      readonly granted: boolean;
      readonly expectedRevision: number;
    },
    options?: { readonly accessToken?: string },
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
  >;
  recordBatch(
    userId: UserId,
    batch: {
      readonly consentVersion: string;
      readonly epoch: string;
      readonly events: ReadonlyArray<
        Omit<StoredProductAnalyticsEvent, "userId" | "receivedAt">
      >;
    },
    options?: { readonly accessToken?: string },
  ): Promise<
    | {
        readonly success: true;
        readonly acceptedIds: readonly string[];
        readonly rejectedCount: number;
      }
    | { readonly success: false; readonly error: "consent_or_epoch_mismatch" }
  >;
  clearEvents(
    userId: UserId,
    options: { readonly expectedRevision: number },
    extra?: { readonly accessToken?: string },
  ): Promise<
    | {
        readonly success: true;
        readonly cleared: true;
        readonly newEpoch: string;
        readonly revision: number;
      }
    | { readonly success: false; readonly error: "revision_mismatch" }
  >;
  listRetainedEvents(
    userId: UserId,
    options?: { readonly limit?: number; readonly accessToken?: string },
  ): Promise<ReadonlyArray<StoredProductAnalyticsEvent>>;
  cleanupExpired(retentionDays?: number): Promise<number>;
}
