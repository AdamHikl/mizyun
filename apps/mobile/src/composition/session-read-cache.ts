import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { AuthSession } from "@mizyun/identity";
import type { Result } from "@mizyun/core";

const LIFETIME_MS = 5 * 60_000;
const MAX_ENTRIES = 512;
const MAX_BYTES = 4_000_000;
const retired = (): Result<never, ApiError> => ({
  ok: false,
  error: { kind: "no_session" },
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

type Entry = {
  value: unknown;
  expiresAt: number;
  schema: RequestOptions["schema"];
  bytes: number;
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
  readonly draftFoodEntry?: ApiClient["draftFoodEntry"];
  readonly draftCoachMealPhoto?: ApiClient["draftCoachMealPhoto"];
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Pending>();
  private identity: string | null = null;
  private revision = 0;
  private writes = 0;
  private bytes = 0;
  private day = "";
  private foreground = true;

  constructor(
    private raw: ApiClient,
    private session: () => Promise<AuthSession | null>,
    private now = () => Date.now(),
  ) {
    this.getMealIllustrationCapability =
      raw.getMealIllustrationCapability?.bind(raw);
    this.ensureMealIllustration = raw.ensureMealIllustration?.bind(raw);
    this.draftFoodEntry = raw.draftFoodEntry?.bind(raw);
    const draftCoachMealPhoto = raw.draftCoachMealPhoto?.bind(raw);
    if (draftCoachMealPhoto)
      this.draftCoachMealPhoto = async (input) => {
        this.writes++;
        this.clear();
        try {
          return await draftCoachMealPhoto(input);
        } finally {
          this.writes--;
          this.clear();
        }
      };
  }
  status() {
    return this.raw.status();
  }
  version(): string {
    const now = new Date(this.now());
    if (
      [...this.entries.values()].some((entry) => entry.expiresAt <= this.now())
    )
      this.clear();
    return `${this.revision}:${now.toDateString()}:${now.getTimezoneOffset()}`;
  }
  setForeground(active: boolean): void {
    if (active === this.foreground) return;
    this.foreground = active;
    // Backgrounding already retired all records. Returning active must not
    // cancel a tab read started by an earlier AppState listener.
    if (!active) this.clear();
  }
  clear(): void {
    this.revision++;
    this.identity = null;
    this.day = "";
    this.entries.clear();
    for (const pending of this.pending.values()) pending.controller.abort();
    this.pending.clear();
    this.bytes = 0;
  }
  private key(session: AuthSession | null): string | null {
    return session ? `${session.user.id}:${session.accessToken}` : null;
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
      this.writes++;
      this.clear();
      try {
        return await this.raw.request<T>(options);
      } finally {
        this.writes--;
        this.clear();
      }
    }
    if (!cacheable(options)) return this.raw.request<T>(options);
    const beforeLookup = this.revision;
    const session = await this.session().catch(() => null);
    if (!this.foreground || beforeLookup !== this.revision) return retired();
    const identity = this.key(session);
    const day = new Date(this.now()).toDateString();
    if (identity !== this.identity || day !== this.day) {
      if (this.day !== "") this.clear();
      this.identity = identity;
      this.day = day;
    }
    if (
      !session ||
      (options.expectedUserId && options.expectedUserId !== session.user.id) ||
      options.isCurrent?.() === false
    )
      return retired();
    const revision = this.revision;
    const key = options.path;
    const entry = this.entries.get(key);
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
        const transport = this.raw
          .request<unknown>({
            ...options,
            signal: controller.signal,
            isCurrent: () => revision === this.revision,
            expectedUserId: session.user.id,
          })
          .catch((cause: unknown): Result<unknown, ApiError> => ({
            ok: false,
            error: { kind: "network_error", cause },
          }));
        promise = Promise.race([transport, timeout])
          .finally(() => clearTimeout(timer))
          .then((result) => {
            if (result.ok && revision === this.revision && !this.writes) {
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
                  expiresAt:
                    this.now() +
                    (/^\/v1\/(?:food-entries(?:\?|$|\/summary)|energy\/summary(?:\?|$))/.test(
                      key,
                    )
                      ? 60_000
                      : LIFETIME_MS),
                  schema: options.schema,
                  bytes,
                });
                this.bytes += bytes;
              }
            }
            return result;
          });
        const record = { promise, schema: options.schema, controller };
        this.pending.set(key, record);
        void promise.finally(() => {
          if (this.pending.get(key) === record) this.pending.delete(key);
        });
      }
    }
    const result = await promise;
    const current = await this.session().catch(() => null);
    if (
      revision !== this.revision ||
      identity !== this.key(current) ||
      options.isCurrent?.() === false
    )
      return retired();
    return result as Result<T, ApiError>;
  }
}
