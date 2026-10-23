import {
  isNotModified,
  resultEtag,
  type ApiClient,
  type ApiError,
  type RequestOptions,
} from "@mizyun/api-client";
import type { AuthSession } from "@mizyun/identity";
import type { Result } from "@mizyun/core";
import type { PersonalReadStorage } from "@/features/offline-cache/personal-read-storage";
import { publishSessionReadUpdate } from "./personal-read-events";

const LIFETIME_MS = 5 * 60_000;
const MAX_ENTRIES = 512;
const MAX_BYTES = 4_000_000;
const retired = (): Result<never, ApiError> => ({
  ok: false,
  error: { kind: "no_session" },
});
// Locking the phone or backgrounding the app retires reads; that is not a
// sign-out. Callers may retry once the app is active again.
const suspended = (): Result<never, ApiError> => ({
  ok: false,
  error: { kind: "context_changed" },
});
const lookupFailed = (cause: unknown): Result<never, ApiError> => ({
  ok: false,
  error: { kind: "network_error", cause },
});

function cacheable(options: RequestOptions): boolean {
  if (
    options.method !== "GET" ||
    !options.schema ||
    options.signal ||
    options.headers
  )
    return false;
  const path = options.path.split("?")[0]!;
  // Only personal display data. Authority, signed media, Community and AI
  // readiness/consent remain live reads through their existing boundaries.
  return (
    [
      "/v1/profile",
      "/v1/goals/active",
      "/v1/energy/summary",
      "/v1/exercises",
      "/v1/body-measurements",
      "/v1/food-entries",
      "/v1/food-entries/summary",
      "/v1/workouts",
      "/v1/runs",
      "/v1/coach/conversations",
    ].includes(path) ||
    /^\/v1\/runs\/[^/]+$/.test(path) ||
    /^\/v1\/workouts\/[^/]+\/sets$/.test(path) ||
    /^\/v1\/coach\/conversations\/[^/]+$/.test(path)
  );
}

const SLOW_LIFETIME_MS = 30 * 60_000;
// Meal entries and totals can change on the server (scheduled meals), so they
// are re-read after a minute. Goals and the exercise library change only
// when the account edits them; edits on this device forget them (see
// affectedReads), so they stay fresh for thirty minutes and an edit on another
// device shows within that time or on pull-to-refresh. The profile stays at
// five minutes like other reads: it carries the plan tier, which Beta Pro
// grants change outside this app.
const lifetime = (path: string): number =>
  /^\/v1\/(?:food-entries(?:\?|$|\/summary)|energy\/summary(?:\?|$))/.test(path)
    ? 60_000
    : /^\/v1\/(?:goals\/active|exercises)(?:\?|$)/.test(path)
      ? SLOW_LIFETIME_MS
      : LIFETIME_MS;

const FOOD = ["/v1/food-entries", "/v1/energy/summary"];
const TRAINING = [
  "/v1/workouts",
  "/v1/exercises",
  "/v1/runs",
  "/v1/energy/summary",
];
const BODY = [
  "/v1/body-measurements",
  "/v1/profile",
  "/v1/goals/active",
  "/v1/energy/summary",
];
const COACH = ["/v1/coach/conversations"];

/**
 * Cached read paths a write can change. `"all"` keeps the original full
 * invalidation and is the answer for every write not listed here, including
 * Coach messages (their tools can log meals or edit workouts) and account
 * changes.
 */
export function affectedReads(
  method: string,
  fullPath: string,
): ReadonlyArray<string> | "all" {
  if (method === "GET") return [];
  const path = fullPath.split("?")[0]!;
  const under = (prefix: string) =>
    path === prefix || path.startsWith(`${prefix}/`);
  // Drafts, signing and feedback store nothing that a cached read returns.
  if (
    under("/v1/food-entries/draft") ||
    under("/v1/activity-drafts") ||
    under("/v1/stretch-plans") ||
    under("/v1/coach/memories") ||
    under("/v1/media") ||
    under("/v1/feedback") ||
    under("/v1/beta-pro/request")
  )
    return [];
  if (under("/v1/food-entries") || under("/v1/recurring-meals")) return FOOD;
  if (
    under("/v1/workouts") ||
    under("/v1/exercises") ||
    under("/v1/runs") ||
    under("/v1/bouldering") ||
    /^\/v1\/community\/routines\/[^/]+\/import$/.test(path)
  )
    return TRAINING;
  if (
    under("/v1/body-measurements") ||
    under("/v1/profile") ||
    under("/v1/goals") ||
    /^\/v1\/energy\/weekly-review\/[^/]+\/decision$/.test(path)
  )
    return BODY;
  // Granting consent can also save the birth year used for energy targets.
  if (path === "/v1/account/ai-consent") return [...COACH, ...BODY];
  if (
    path === "/v1/coach/conversations" ||
    /^\/v1\/coach\/conversations\/[^/]+$/.test(path)
  )
    return COACH;
  return "all";
}

type Entry = {
  value: unknown;
  expiresAt: number;
  schema: RequestOptions["schema"];
  bytes: number;
  savedAt: number;
  storageGeneration?: number;
  /**
   * Server validator from a 200 in this process; a stale record is
   * revalidated with If-None-Match. Never saved on the device, so a value
   * parsed by an older app build is never confirmed by an unchanged tag.
   */
  etag?: string;
};
type Pending = {
  promise: Promise<Result<unknown, ApiError>>;
  schema: RequestOptions["schema"];
  controller: AbortController;
};

/** Session-only memory; invalidation retires both stored and in-flight reads. */
export class SessionReadCache implements ApiClient {
  // Decoration has its own live authority and never invalidates nutrition reads.
  readonly getMealIllustrationCapability?: ApiClient["getMealIllustrationCapability"];
  readonly ensureMealIllustration?: ApiClient["ensureMealIllustration"];
  readonly getMealRecipeSessionContext?: ApiClient["getMealRecipeSessionContext"];
  readonly revalidateMealRecipes?: ApiClient["revalidateMealRecipes"];
  readonly getMealRecipeCapabilities?: ApiClient["getMealRecipeCapabilities"];
  readonly suggestMealRecipes?: ApiClient["suggestMealRecipes"];
  readonly recognizeMealRecipeIngredients?: ApiClient["recognizeMealRecipeIngredients"];
  readonly assistMealRecipe?: ApiClient["assistMealRecipe"];
  readonly draftFoodEntry?: ApiClient["draftFoodEntry"];
  readonly draftCoachMealPhoto?: ApiClient["draftCoachMealPhoto"];
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Pending>();
  private identity: string | null = null;
  private revision = 0;
  private writes = 0;
  private bytes = 0;
  private day = "";
  private utcOffset: number | null = null;
  private foreground = true;
  private hydration: Promise<void> | null = null;
  private hydrated = false;
  // Only the first hydration after launch may treat saved records as fresh.
  // After an explicit clear (pull-to-refresh, account change, full write
  // invalidation) saved records are shown but always revalidated.
  private diskFresh = true;
  private hydrationStarted = false;
  private listeners = new Set<(path: string) => void>();
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  // Owner -> the access token the server denied.
  private deniedOwners = new Map<string, string>();
  private drained: (() => void)[] = [];
  // Storage generations produced by this cache's own write purges.
  private ownPurges = new Set<string>();

  constructor(
    private raw: ApiClient,
    private session: () => Promise<AuthSession | null>,
    private now = () => Date.now(),
    private storage?: PersonalReadStorage,
  ) {
    this.getMealIllustrationCapability =
      raw.getMealIllustrationCapability?.bind(raw);
    this.ensureMealIllustration = raw.ensureMealIllustration?.bind(raw);
    this.getMealRecipeSessionContext =
      raw.getMealRecipeSessionContext?.bind(raw);
    this.revalidateMealRecipes = raw.revalidateMealRecipes?.bind(raw);
    this.getMealRecipeCapabilities = raw.getMealRecipeCapabilities?.bind(raw);
    this.suggestMealRecipes = raw.suggestMealRecipes?.bind(raw);
    this.recognizeMealRecipeIngredients =
      raw.recognizeMealRecipeIngredients?.bind(raw);
    this.assistMealRecipe = raw.assistMealRecipe?.bind(raw);
    this.draftFoodEntry = raw.draftFoodEntry?.bind(raw);
    const draftCoachMealPhoto = raw.draftCoachMealPhoto?.bind(raw);
    if (draftCoachMealPhoto)
      this.draftCoachMealPhoto = async (input) => {
        this.writes++;
        this.clear();
        try {
          const owner = await this.session().catch(() => null);
          if (!owner) return retired();
          await this.purgeSaved(owner.user.id);
          if (
            this.key(owner) !== this.key(await this.session().catch(() => null))
          )
            return retired();
          return await draftCoachMealPhoto(input);
        } catch (cause) {
          return { ok: false, error: { kind: "network_error", cause } };
        } finally {
          this.writes--;
          this.clear();
          this.release();
        }
      };
  }
  status() {
    return this.raw.status();
  }
  subscribe(listener: (path: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(path: string): void {
    for (const listener of this.listeners) listener(path);
    publishSessionReadUpdate(path);
  }
  private async hydrate(userId: string, revision: number): Promise<void> {
    if (!this.storage || this.deniedOwners.has(userId)) return;
    if (!this.hydration) {
      this.hydrationStarted = true;
      const storageGeneration = this.storage.generation?.(userId);
      this.hydration = this.storage
        .load(userId)
        .then((records) => {
          if (
            revision !== this.revision ||
            storageGeneration !== this.storage?.generation?.(userId)
          )
            return;
          for (const record of records) {
            // Memory kept across a background is never older than disk.
            const kept = this.entries.get(record.path);
            if (kept && kept.savedAt >= record.savedAt) continue;
            const bytes = JSON.stringify(record.value).length * 2;
            const replaced = kept?.bytes ?? 0;
            if (
              (!kept && this.entries.size >= MAX_ENTRIES) ||
              this.bytes - replaced + bytes > MAX_BYTES
            )
              break;
            this.bytes -= replaced;
            this.entries.set(record.path, {
              value: record.value,
              savedAt: record.savedAt,
              schema: undefined,
              bytes,
              // At launch, a record saved moments ago is as fresh as one in memory.
              expiresAt: this.diskFresh
                ? record.savedAt + lifetime(record.path)
                : 0,
              storageGeneration,
            });
            this.bytes += bytes;
          }
          this.hydrated = true;
          if (records.length > 0) this.publish("*");
        })
        .catch(() => {});
    }
    await this.hydration;
  }
  private persist(
    userId: string,
    generation = this.storage?.generation?.(userId),
  ): void {
    if (!this.storage || this.deniedOwners.has(userId)) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      if (generation !== this.storage!.generation?.(userId)) return;
      const records = [...this.entries]
        .filter(([, entry]) => entry.storageGeneration === generation)
        .map(([path, entry]) => ({
          path,
          value: entry.value,
          savedAt: entry.savedAt,
        }));
      void this.storage!.save(userId, records).catch(() => {});
    }, 100);
  }
  private async purgeSaved(owner?: string): Promise<void> {
    clearTimeout(this.persistTimer);
    const userId = owner ?? (await this.session().catch(() => null))?.user.id;
    if (!userId || !this.storage) return;
    // The adapter fences the generation synchronously when purge starts.
    const purge = this.storage.purge(userId);
    const generation = this.storage.generation?.(userId);
    if (generation !== undefined) this.ownPurges.add(`${userId}:${generation}`);
    await purge;
  }
  /** True when someone other than this cache (account cleanup) purged. */
  private cleanedUp(userId: string, from: number | undefined): boolean {
    const to = this.storage?.generation?.(userId);
    if (from === undefined || to === undefined) return from !== to;
    for (let generation = from + 1; generation <= to; generation++)
      if (!this.ownPurges.has(`${userId}:${generation}`)) return true;
    return false;
  }
  version(): string {
    const now = new Date(this.now());
    return `${this.revision}:${now.toDateString()}:${now.getTimezoneOffset()}`;
  }
  setForeground(active: boolean): void {
    if (active === this.foreground) return;
    this.foreground = active;
    // Backgrounding retires in-flight reads but keeps the records, which are
    // the same display data already saved on this device. The next read
    // re-checks the account, day and timezone. Returning active must not
    // cancel a tab read started by an earlier AppState listener.
    if (!active) this.retire();
  }
  clear(): void {
    clearTimeout(this.persistTimer);
    // A clear before anything loaded (auth restoring at launch) keeps it.
    if (this.hydrationStarted || this.entries.size > 0) this.diskFresh = false;
    this.retire();
    this.identity = null;
    this.day = "";
    this.utcOffset = null;
    this.entries.clear();
    this.hydration = null;
    this.hydrated = false;
    this.bytes = 0;
  }
  /** Retires in-flight reads and their callers without forgetting records. */
  private retire(): void {
    this.revision++;
    // A hydration the retirement interrupted is discarded, so allow another.
    if (!this.hydrated) this.hydration = null;
    for (const pending of this.pending.values()) pending.controller.abort();
    this.pending.clear();
  }
  private forget(paths: ReadonlyArray<string>): void {
    for (const [key, entry] of this.entries) {
      const path = key.split("?")[0]!;
      if (
        paths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
      ) {
        this.bytes -= entry.bytes;
        this.entries.delete(key);
      }
    }
  }
  /**
   * Replaces the device copy with the remaining records before a write, so a
   * record the write changes is never left saved. Fails closed like a purge.
   */
  private async replaceSaved(userId: string): Promise<void> {
    clearTimeout(this.persistTimer);
    if (!this.storage) return;
    if (!this.storage.replace || this.deniedOwners.has(userId))
      return this.purgeSaved(userId);
    const generation = this.storage.generation?.(userId);
    const records = [...this.entries]
      .filter(([, entry]) => entry.storageGeneration === generation)
      .map(([path, entry]) => ({
        path,
        value: entry.value,
        savedAt: entry.savedAt,
      }));
    await this.storage.replace(userId, records);
  }
  private key(session: AuthSession | null): string | null {
    return session ? `${session.user.id}:${session.accessToken}` : null;
  }
  // Display records belong to the account, not to one access token: a routine
  // token refresh keeps them, while another account or sign-out clears them.
  private owner(session: AuthSession | null): string | null {
    return session ? session.user.id : null;
  }
  /** Read already hydrated display data during render, without IO or a new lease. */
  peek<T>(
    options: RequestOptions,
    session: AuthSession | null,
  ): Result<T, ApiError> | null {
    const now = this.now();
    const date = new Date(now);
    if (
      !cacheable(options) ||
      !session ||
      !this.foreground ||
      this.writes ||
      this.identity !== this.owner(session) ||
      this.day !== date.toDateString() ||
      this.utcOffset !== date.getTimezoneOffset() ||
      (options.expectedUserId && options.expectedUserId !== session.user.id) ||
      options.isCurrent?.() === false ||
      this.deniedOwners.has(session.user.id)
    )
      return null;
    const entry = this.entries.get(options.path);
    if (
      !entry ||
      entry.storageGeneration !== this.storage?.generation?.(session.user.id) ||
      (entry.schema !== undefined && entry.schema !== options.schema)
    )
      return null;
    const fresh = entry.expiresAt > now;
    const saved =
      this.storage &&
      now >= entry.savedAt &&
      now - entry.savedAt <= 48 * 60 * 60_000;
    if (!fresh && !saved) return null;
    const parsed = options.schema!.safeParse(entry.value);
    if (!parsed.success) return null;
    return {
      ok: true,
      value: parsed.data as T,
      ...(!fresh ? { savedAt: entry.savedAt } : {}),
    };
  }
  async request<T>(options: RequestOptions): Promise<Result<T, ApiError>> {
    // These writes only update push delivery or the separate analytics store;
    // they cannot change any personal display data. Startup runs them alongside
    // tab reads, so invalidating those reads would fabricate a missing session.
    const path = options.path.split("?")[0];
    if (
      (options.method === "PUT" && path === "/v1/beta-pro/push-token") ||
      (options.method === "PUT" && path === "/v1/analytics/consent") ||
      (["POST", "DELETE"].includes(options.method) &&
        path === "/v1/analytics/events")
    )
      return this.raw.request<T>(options);
    // Social read commands and writes own their separate authorization store.
    // Importing a shared routine is the one social command that creates a
    // personal workout and therefore invalidates these screen reads.
    if (
      options.path.startsWith("/v1/community/") &&
      !/^\/v1\/community\/routines\/[^/]+\/import$/.test(options.path)
    )
      return this.raw.request<T>(options);
    if (options.method !== "GET") {
      const affected = affectedReads(options.method, options.path);
      // Every write retires in-flight reads; only the records it can change
      // are forgotten, here and on the device, before it is sent.
      const invalidate = () => {
        if (affected === "all") this.clear();
        else {
          this.retire();
          this.forget(affected);
        }
      };
      this.writes++;
      invalidate();
      try {
        const owner = await this.session().catch(() => null);
        if (
          !owner ||
          (options.expectedUserId &&
            options.expectedUserId !== owner.user.id) ||
          options.isCurrent?.() === false
        )
          return retired();
        if (affected === "all") await this.purgeSaved(owner.user.id);
        else if (affected.length > 0 && this.identity === this.owner(owner))
          await this.replaceSaved(owner.user.id);
        else if (affected.length > 0) await this.purgeSaved(owner.user.id);
        if (
          this.key(owner) !==
            this.key(await this.session().catch(() => null)) ||
          options.isCurrent?.() === false
        )
          return retired();
        return await this.raw.request<T>({
          ...options,
          expectedUserId: owner.user.id,
          isCurrent: options.isCurrent,
        });
      } catch (cause) {
        return { ok: false, error: { kind: "network_error", cause } };
      } finally {
        this.writes--;
        invalidate();
        this.release();
      }
    }
    if (!cacheable(options)) return this.raw.request<T>(options);
    // Token rotation, a write or an explicit refresh retires in-flight reads.
    // That is not a sign-out: retry for a caller that is still current, for
    // the same account, instead of reporting a missing session.
    let attempt = options;
    for (let tries = 1; ; tries++) {
      const outcome = await this.read<T>(attempt);
      if ("result" in outcome) return outcome.result;
      if (!this.foreground && options.isCurrent?.() !== false)
        return suspended();
      if (
        tries >= 3 ||
        !outcome.owner ||
        (attempt.expectedUserId && attempt.expectedUserId !== outcome.owner) ||
        this.deniedOwners.has(outcome.owner) ||
        !this.foreground ||
        options.isCurrent?.() === false
      )
        return retired();
      attempt = { ...options, expectedUserId: outcome.owner };
      await this.writesDrained();
    }
  }
  private release(): void {
    if (this.writes) return;
    for (const resolve of this.drained.splice(0)) resolve();
  }
  /** A retry normally observes the write that retired it. */
  private writesDrained(): Promise<void> {
    if (!this.writes) return Promise.resolve();
    return new Promise((resolve) => {
      // A long write (a Coach reply) must not stall other screens' retries.
      const timer = setTimeout(resolve, 5_000);
      this.drained.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  private async read<T>(
    options: RequestOptions,
  ): Promise<{ result: Result<T, ApiError> } | { owner: string | null }> {
    const beforeLookup = this.revision;
    const lookup = await this.session().then(
      (session) => ({ session }),
      (cause: unknown) => ({ session: null, cause }),
    );
    // A token refresh that cannot reach Auth (for example right after
    // unlocking) is a transient failure, not a missing session.
    if ("cause" in lookup && this.foreground && beforeLookup === this.revision)
      return { result: lookupFailed(lookup.cause) };
    const session = lookup.session;
    if (!this.foreground || beforeLookup !== this.revision)
      return { owner: session?.user.id ?? null };
    const identity = this.owner(session);
    const day = new Date(this.now()).toDateString();
    const utcOffset = new Date(this.now()).getTimezoneOffset();
    if (
      identity !== this.identity ||
      day !== this.day ||
      utcOffset !== this.utcOffset
    ) {
      if (this.day !== "") this.clear();
      this.identity = identity;
      this.day = day;
      this.utcOffset = utcOffset;
    }
    // A different token for a previously denied owner is a fresh sign-in.
    const denied = session && this.deniedOwners.get(session.user.id);
    if (denied && denied !== session.accessToken)
      this.deniedOwners.delete(session.user.id);
    if (
      !session ||
      (options.expectedUserId && options.expectedUserId !== session.user.id) ||
      options.isCurrent?.() === false
    )
      return { owner: session?.user.id ?? null };
    const revision = this.revision;
    const storageGeneration = this.storage?.generation?.(session.user.id);
    if (!this.writes) await this.hydrate(session.user.id, revision);
    if (revision !== this.revision || options.isCurrent?.() === false)
      return { owner: session?.user.id ?? null };
    const key = options.path;
    let entry = this.entries.get(key);
    if (entry && entry.storageGeneration !== storageGeneration) {
      this.bytes -= entry.bytes;
      this.entries.delete(key);
      entry = undefined;
    }
    // Disk is untrusted and may have been written by an older app schema.
    if (entry && entry.schema === undefined) {
      const parsed = options.schema!.safeParse(entry.value);
      if (parsed.success) {
        entry.value = parsed.data;
        entry.schema = options.schema;
      } else {
        this.bytes -= entry.bytes;
        this.entries.delete(key);
        entry = undefined;
      }
    }
    const saved =
      this.storage &&
      !this.writes &&
      entry &&
      entry.schema === options.schema &&
      this.now() - entry.savedAt <= 48 * 60 * 60_000
        ? entry
        : undefined;
    let promise: Promise<Result<unknown, ApiError>>;
    if (
      !this.writes &&
      entry &&
      entry.schema === options.schema &&
      entry.expiresAt > this.now()
    ) {
      promise = Promise.resolve({ ok: true, value: entry.value });
    } else {
      const pending = this.pending.get(key);
      if (!this.writes && pending && pending.schema === options.schema)
        promise = pending.promise;
      else {
        // Each caller checks its own lifetime after sharing the transport.
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<Result<unknown, ApiError>>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve({
              ok: false,
              error: {
                kind: "network_error",
                cause: "Screen data request timed out",
              },
            });
          }, 20_000);
        });
        // A stale record with a server validator is revalidated: an
        // unchanged response comes back as 304 without its body.
        const validator =
          !this.writes && entry && entry.schema === options.schema && entry.etag
            ? { etag: entry.etag, value: entry.value }
            : undefined;
        const transport = this.raw
          .request<unknown>({
            ...options,
            signal: controller.signal,
            isCurrent: () => revision === this.revision,
            expectedUserId: session.user.id,
            ...(validator ? { ifNoneMatch: validator.etag } : {}),
          })
          .then((result): Result<unknown, ApiError> =>
            !isNotModified(result)
              ? result
              : validator
                ? ({
                    ok: true,
                    value: validator.value,
                    etag: validator.etag,
                  } as Result<unknown, ApiError>)
                : {
                    ok: false,
                    error: {
                      kind: "network_error",
                      cause: "Not modified without a saved response",
                    },
                  },
          )
          .catch((cause: unknown): Result<unknown, ApiError> => ({
            ok: false,
            error: { kind: "network_error", cause },
          }));
        promise = Promise.race([transport, timeout])
          .finally(() => clearTimeout(timer))
          .then((result) => {
            if (
              result.ok &&
              revision === this.revision &&
              !this.writes &&
              storageGeneration === this.storage?.generation?.(session.user.id)
            ) {
              const bytes = (JSON.stringify(result.value)?.length ?? 0) * 2;
              if (bytes <= MAX_BYTES) {
                const previous = this.entries.get(key);
                if (previous) this.bytes -= previous.bytes;
                this.entries.delete(key);
                while (
                  this.entries.size >= MAX_ENTRIES ||
                  this.bytes + bytes > MAX_BYTES
                ) {
                  const oldest = this.entries.keys().next().value;
                  if (oldest === undefined) break;
                  this.bytes -= this.entries.get(oldest)!.bytes;
                  this.entries.delete(oldest);
                }
                this.entries.set(key, {
                  value: result.value,
                  expiresAt: this.now() + lifetime(key),
                  schema: options.schema,
                  bytes,
                  savedAt: this.now(),
                  storageGeneration,
                  etag: resultEtag(result),
                });
                this.bytes += bytes;
                this.persist(session.user.id, storageGeneration);
                this.publish(key);
              }
            }
            if (
              revision === this.revision &&
              !result.ok &&
              (result.error.kind === "session_expired" ||
                result.error.kind === "no_session" ||
                (result.error.kind === "http_error" &&
                  [401, 403].includes(result.error.status)))
            ) {
              void this.purgeSaved(session.user.id).catch(() => {});
              this.deniedOwners.set(session.user.id, session.accessToken);
              this.clear();
              if (saved) this.publish(key);
            }
            // Validators stay internal to the cache.
            return result.ok ? { ok: true, value: result.value } : result;
          });
        const record = { promise, schema: options.schema, controller };
        this.pending.set(key, record);
        void promise.finally(() => {
          if (this.pending.get(key) === record) this.pending.delete(key);
        });
      }
      // Saved display data never waits for the network. Each mounted tab is
      // notified when its shared background read replaces this snapshot.
      if (saved)
        promise = Promise.resolve({
          ok: true,
          value: saved.value,
          savedAt: saved.savedAt,
        });
    }
    const result = await promise;
    const current = await this.session().catch(() => null);
    // Account cleanup purged this owner's data: the read stays retired
    // rather than repopulating storage after sign-out or erasure.
    if (this.cleanedUp(session.user.id, storageGeneration))
      return { owner: null };
    if (storageGeneration !== this.storage?.generation?.(session.user.id))
      return { owner: session.user.id };
    if (
      revision !== this.revision ||
      identity !== this.owner(current) ||
      options.isCurrent?.() === false
    )
      return { owner: session?.user.id ?? null };
    return { result: result as Result<T, ApiError> };
  }
}
