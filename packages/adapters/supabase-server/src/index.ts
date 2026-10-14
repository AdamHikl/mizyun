import { createClient } from "@supabase/supabase-js";

import type { UserId } from "@mizyun/core";
import type { AccessTokenVerifier, AuthPrincipal } from "@mizyun/identity";

interface ClaimsClient {
  readonly auth: {
    getClaims(jwt: string): Promise<{
      readonly data: { readonly claims?: Record<string, unknown> } | null;
      readonly error: unknown;
    }>;
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SupabaseAccessTokenVerifier implements AccessTokenVerifier {
  constructor(private readonly client: ClaimsClient) {}

  async verify(accessToken: string): Promise<AuthPrincipal | null> {
    if (!accessToken) return null;

    const { data, error } = await this.client.auth.getClaims(accessToken);
    if (error || !data?.claims) return null;

    const subject = data.claims.sub;
    if (typeof subject !== "string" || !UUID_PATTERN.test(subject)) return null;

    const email = data.claims.email;
    const role = data.claims.role;

    return {
      userId: subject as UserId,
      accessToken,
      ...(typeof email === "string" ? { email } : {}),
      ...(typeof role === "string" ? { role } : {}),
    };
  }
}

export interface SupabaseServerConfiguration {
  readonly url: string;
  readonly publishableKey: string;
}

export const createSupabaseAccessTokenVerifier = (
  configuration: SupabaseServerConfiguration,
): AccessTokenVerifier => {
  const client = createClient(configuration.url, configuration.publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  return new SupabaseAccessTokenVerifier(client);
};

/**
 * Public subset of the Supabase client that the per-feature
 * repository adapters consume. The interface is intentionally
 * narrow so the adapters don't reach for accidental surface
 * area (raw RPC, storage SDK, etc.) before those segments land.
 */
export interface RepositorySupabaseClient {
  from<T extends Record<string, unknown>>(
    table: string,
  ): RepositoryTableBuilder<T>;
  /**
   * Call a stored SQL function (`create function …`) on the public
   * schema. Used by AI-OPS-001 to invoke the SECURITY DEFINER
   * limiter RPCs that own the rate-limit state. Returns the
   * function's rowset directly; the caller maps to a domain shape.
   */
  rpc<TRow extends Record<string, unknown>>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<RepositoryRpcResult<TRow>>;
  auth: {
    /**
     * Bind the verified user's access token to the client so
     * PostgREST queries run under RLS for that principal.
     * Refresh-token rotation is not handled in PERSIST-001; an
     * expired token returns 401 from the API and the mobile app
     * re-authenticates.
     */
    setSession(options: { readonly access_token: string }): Promise<{
      readonly data: { readonly user: { readonly id: string } | null };
      readonly error: unknown;
    }>;
  };
}

export interface RepositoryRpcResult<TRow extends Record<string, unknown>> {
  readonly data: ReadonlyArray<TRow>;
  readonly error: { readonly code?: string; readonly message: string } | null;
}

/**
 * PostgREST fluent-builder surface for a single table. `select`,
 * `insert`, `update`, and `delete` each open a query chain;
 * terminal methods (`single`, `maybeSingle`, plain `await`)
 * execute it.
 */
export interface RepositoryTableBuilder<T> {
  select(columns?: string): RepositoryQueryBuilder<T>;
  insert(
    row: Partial<T> | ReadonlyArray<Partial<T>>,
  ): RepositoryQueryBuilder<T>;
  upsert(
    row: Partial<T> | ReadonlyArray<Partial<T>>,
    options?: {
      readonly onConflict?: string;
      readonly ignoreDuplicates?: boolean;
    },
  ): RepositoryQueryBuilder<T>;
  update(row: Partial<T>): RepositoryQueryBuilder<T>;
  delete(): RepositoryQueryBuilder<T>;
}

/**
 * Awaits the query as a list of rows. Single-row callers chain
 * `.single()` or `.maybeSingle()` instead of `await`ing.
 */
export interface RepositoryListResult<T> {
  readonly data: ReadonlyArray<T>;
  readonly error: { readonly code?: string; readonly message: string } | null;
}

export interface RepositorySingleResult<T> {
  readonly data: T | null;
  readonly error: { readonly code?: string; readonly message: string } | null;
}

/**
 * Chainable filter / ordering / limit methods. Every method
 * returns a new builder so adapters can compose freely. The
 * terminal method (`single`/`maybeSingle`/`then`) produces
 * a result the adapter maps to Mizyun's `apiErrorCode` union.
 */
export interface RepositoryQueryBuilder<T> {
  eq(
    column: (keyof T & string) | (string & {}),
    value: unknown,
  ): RepositoryQueryBuilder<T>;
  neq(
    column: (keyof T & string) | (string & {}),
    value: unknown,
  ): RepositoryQueryBuilder<T>;
  gte(column: keyof T & string, value: string): RepositoryQueryBuilder<T>;
  lte(column: keyof T & string, value: string): RepositoryQueryBuilder<T>;
  gt(column: keyof T & string, value: string): RepositoryQueryBuilder<T>;
  lt(column: keyof T & string, value: string): RepositoryQueryBuilder<T>;
  in(
    column: keyof T & string,
    values: ReadonlyArray<unknown>,
  ): RepositoryQueryBuilder<T>;
  is(column: keyof T & string, value: unknown): RepositoryQueryBuilder<T>;
  ilike(
    column: (keyof T & string) | (string & {}),
    pattern: string,
  ): RepositoryQueryBuilder<T>;
  or(filters: string): RepositoryQueryBuilder<T>;
  order(
    column: keyof T & string,
    options?: { readonly ascending?: boolean; readonly nullsFirst?: boolean },
  ): RepositoryQueryBuilder<T>;
  limit(count: number): RepositoryQueryBuilder<T>;
  range(from: number, to: number): RepositoryQueryBuilder<T>;
  /** Append an extra filter to the chain. */
  match(criteria: Partial<T>): RepositoryQueryBuilder<T>;
  /**
   * PostgREST allows `.select(columns?)` after `.insert(...)` /
   * `.update(...)` / `.delete()` to return the affected rows.
   * We mirror that on the builder so adapters can write
   * `insert(...).select('*').single()`.
   */
  select(columns?: string): RepositoryQueryBuilder<T>;
  /** Switch the chain to single-row mode. */
  single(): Promise<RepositorySingleResult<T>>;
  /** Switch to optional single-row mode (no rows → null data, no error). */
  maybeSingle(): Promise<RepositorySingleResult<T>>;
  /** Promise/Await support. Adapters prefer the typed terminals above. */
  then<TResult>(
    resolve: (value: RepositoryListResult<T>) => TResult | PromiseLike<TResult>,
  ): PromiseLike<TResult>;
}

/**
 * Construct a per-request Supabase client bound to the verified
 * user's access token. RLS is the security boundary; the
 * adapter never escalates to the service role for table
 * operations.
 *
 * Each request gets its own client instance so concurrent
 * requests cannot share a session.
 */
export const createSupabaseRepositoryClient = (
  configuration: SupabaseServerConfiguration,
  accessToken: string,
): RepositorySupabaseClient => {
  if (!accessToken) {
    throw new Error(
      "createSupabaseRepositoryClient requires a non-empty access token",
    );
  }
  const raw = createClient(configuration.url, configuration.publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      // Bind the already-verified principal synchronously. Calling the async
      // auth.setSession() and immediately issuing a query races the first
      // PostgREST request, which can otherwise run with the anon key.
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
  // The cast narrows the surface area the adapters see; the
  // underlying Supabase JS client retains its real typing. We
  // own both ends.
  return raw as unknown as RepositorySupabaseClient;
};

/**
 * Construct a service-role Supabase client for backend-only work
 * that must bypass RLS. AI-OPS-001's SECURITY DEFINER RPCs are
 * the primary consumer: the limiter tables are locked down to
 * `select` for `authenticated`, so writes have to flow through
 * the service role.
 *
 * The caller MUST hold the service-role key in process memory
 * (e.g. via `@mizyun/config`'s `SUPABASE_SERVICE_ROLE_KEY`) and
 * never expose it to a browser bundle. The key never leaves the
 * server.
 */
export const createSupabaseServiceRoleClient = (
  configuration: SupabaseServerConfiguration & {
    readonly serviceRoleKey: string;
  },
): RepositorySupabaseClient => {
  const raw = createClient(configuration.url, configuration.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return raw as unknown as RepositorySupabaseClient;
};

export { SupabaseProfileRepository } from "./profile-repository.js";
export { SupabaseMemoryStore } from "./memory-store.js";
export { SupabaseGoalRepository } from "./goal-repository.js";
export { SupabaseFoodEntryRepository } from "./food-entry-repository.js";
export { RepositoryError } from "./repository-error.js";

export { SupabaseExerciseRepository } from "./exercise-repository.js";
export { SupabaseWorkoutRepository } from "./workout-repository.js";
export { SupabaseWorkoutSetRepository } from "./workout-set-repository.js";
export { SupabaseBodyMeasurementRepository } from "./body-measurement-repository.js";
export { SupabaseFeedbackRepository } from "./feedback-repository.js";
export { SupabaseMediaAssetRepository } from "./media-asset-repository.js";
export { SupabaseConversationRepository } from "./conversation-repository.js";
export { SupabaseAccountRepository } from "./account-repository.js";
export { SupabaseAccountProviderRevocationRepository } from "./account-provider-revocation-repository.js";
export {
  SupabaseAiConsentRepository,
  aiConsentFromRow,
  type AiConsentRow,
  type SupabaseAiConsentRepositoryOptions,
} from "./ai-consent-repository.js";
export {
  SupabaseMediaStorage,
  MediaStorageError,
  createSupabaseStorageClient,
  type StorageSupabaseClient,
  type SupabaseMediaStorageOptions,
} from "./media-storage.js";
export {
  SupabaseProductAnalyticsRepository,
  productAnalyticsConsentFromRow,
  productAnalyticsEventFromRow,
  type ProductAnalyticsConsentRow,
  type ProductAnalyticsEventRow,
  type SupabaseProductAnalyticsRepositoryOptions,
} from "./product-analytics-repository.js";
export {
  SupabaseCommunityRepository,
  communityProfileFromRow,
  followRelationshipFromRow,
  communityBlockFromRow,
  sharedActivityFromRow,
  communityReportFromRow,
  type CommunityProfileRow,
  type CommunityRelationshipRow,
  type CommunityBlockRow,
  type SharedActivityRow,
  type CommunityReactionRow,
  type CommunityReportRow,
  type SupabaseCommunityRepositoryOptions,
} from "./community-repository.js";

export * from "./community-notification-repository.js";

export * from "./community-messaging.js";

export * from "./community-broader-discovery.js";

export * from "./community-comments-repository.js";

export * from "./community-groups-repository.js";

export * from "./community-routines-repository.js";

export * from "./community-challenges.js";

export * from "./community-features.js";

export * from "./community-media.js";

export { SupabaseRecurringMealRepository } from "./recurring-meal-repository.js";

export { SupabaseRunRepository } from "./run-repository.js";
export * from "./meal-photos.js";

export {
  SupabaseMealIllustrationRepository,
  processMealIllustration,
} from "./meal-illustrations.js";

export * from "./recipe-request-ledger";
export { SupabaseRecurringMealSuggestionRepository } from "./recurring-meal-suggestion-repository.js";
