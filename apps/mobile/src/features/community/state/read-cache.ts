import type { ApiClient, ApiError, RequestOptions } from "@mizyun/api-client";
import type { AuthSession } from "@mizyun/identity";
import type { Result } from "@mizyun/core";

export const COMMUNITY_READ_LIFETIME_MS = 10_000;
const MAX_ENTRIES = 32;
const MAX_ENTRY_BYTES = 128_000;
const deadlines = new WeakMap<object, number>();
const stores = new Set<CommunityReadCache>();

/** A restored response never starts a new authorization lifetime. */
export function getCommunityReadDeadline(value: unknown): number | undefined {
  return typeof value === "object" && value !== null
    ? deadlines.get(value)
    : undefined;
}

/** Deliberate refresh and local writes must not reuse navigation snapshots. */
export function invalidateCommunityReads(): void {
  for (const store of stores) store.clear();
}
export function setCommunityReadPrincipal(principal: string | null): void {
  for (const store of stores) store.setPrincipal(principal);
}

function readKey(options: RequestOptions): string | null {
  if (!options.schema || options.signal || options.headers) return null;
  const path = options.path.split("?")[0]!;
  if (options.method === "GET") {
    // No lookup/invitation tokens, private source previews, photo bytes,
    // moderation queues or inbox destination resolution in this store.
    const allowed =
      [
        "/v1/community/profile",
        "/v1/community/features",
        "/v1/community/feed",
        "/v1/community/blocks",
        "/v1/community/mutes",
        "/v1/community/routines",
        "/v1/community/comments/preferences",
        "/v1/community/comments/mentions",
        "/v1/community/notifications/inbox",
        "/v1/community/notifications/preferences",
        "/v1/community/safety/contact",
      ].includes(path) ||
      /^\/v1\/community\/relationships\/(incoming|outgoing|following|followers)$/.test(
        path,
      ) ||
      /^\/v1\/community\/activities\/[^/]+(?:\/(reactions|comments|comments\/candidates))?$/.test(
        path,
      );
    return allowed ? `GET ${options.path}` : null;
  }
  if (
    options.method !== "POST" ||
    !options.body ||
    typeof options.body !== "object"
  )
    return null;
  const body = options.body as Record<string, unknown>;
  const operation = body.operation;
  const allowed =
    (path === "/v1/community/groups/operations" &&
      ["list", "inbox", "read"].includes(String(operation))) ||
    (path === "/v1/community/messaging" &&
      (["contacts", "list", "listMine"].includes(String(operation)) ||
        (operation === "preferences" && Object.keys(body).length === 1))) ||
    (path === "/v1/community/challenges" &&
      ["list", "get", "listMine", "getMine"].includes(String(operation))) ||
    (path === "/v1/community/broader-discovery" &&
      operation === "preferences" &&
      Object.keys(body).length === 1);
  if (!allowed) return null;
  return `POST ${options.path} ${JSON.stringify(body, Object.keys(body).sort())}`;
}

function isRead(options: RequestOptions): boolean {
  if (options.method === "GET") return true;
  if (readKey(options)) return true;
  // These uncached POST reads must not be confused with writes.
  if (/^\/v1\/community\/media\/[^/]+\/content$/.test(options.path))
    return true;
  if (options.path === "/v1/community/routines/preview") return true;
  const operation = (options.body as Record<string, unknown> | undefined)
    ?.operation;
  return (
    [
      "/v1/community/broader-discovery",
      "/v1/community/groups/operations",
    ].includes(options.path) &&
    ["search", "staffAppeals", "preferences"].includes(String(operation)) &&
    (operation !== "preferences" ||
      Object.keys(options.body as object).length === 1)
  );
}

type Entry = {
  value: unknown;
  expiresAt: number;
  schema: RequestOptions["schema"];
  timer: ReturnType<typeof setTimeout>;
};
type Pending = {
  promise: Promise<Result<unknown, ApiError>>;
  scopes: Set<() => boolean>;
  expiresAt: number;
  revision: number;
  schema: RequestOptions["schema"];
};

/** Bounded foreground memory, owned by the mobile composition, never disk. */
export class CommunityReadCache implements ApiClient {
  readonly draftFoodEntry?: ApiClient["draftFoodEntry"];
  readonly draftCoachMealPhoto?: ApiClient["draftCoachMealPhoto"];
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Pending>();
  private foreground = false;
  private principal: string | null = null;
  private token: string | null = null;
  private revision = 0;
  private writes = 0;

  constructor(
    private raw: ApiClient,
    private session: () => Promise<AuthSession | null>,
  ) {
    stores.add(this);
    this.draftFoodEntry = raw.draftFoodEntry?.bind(raw);
    this.draftCoachMealPhoto = raw.draftCoachMealPhoto?.bind(raw);
  }
  status = () => this.raw.status();

  clear(): void {
    this.revision++;
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
    this.entries.clear();
    this.pending.clear();
  }
  setForeground(value: boolean): void {
    if (value !== this.foreground || !value) this.clear();
    this.foreground = value;
  }
  setPrincipal(value: string | null): void {
    if (value !== this.principal || value === null) {
      this.clear();
      this.token = null;
    }
    this.principal = value;
  }
  dispose(): void {
    this.clear();
    stores.delete(this);
  }

  async request<T>(options: RequestOptions): Promise<Result<T, ApiError>> {
    const current = () =>
      options.isCurrent?.() !== false && !options.signal?.aborted;
    if (!current()) return { ok: false, error: { kind: "no_session" } };
    const key = readKey(options);
    if (!isRead(options)) {
      this.clear();
      this.writes++;
      try {
        return await this.raw.request<T>(options);
      } finally {
        this.writes--;
        // A concurrent read may have observed the pre-commit state. A lost
        // response is also ambiguous, so retire it on every completion path.
        this.clear();
      }
    }
    if (
      !key ||
      !this.foreground ||
      !options.expectedUserId ||
      this.writes > 0
    ) {
      try {
        const result = await this.raw.request<T>(options);
        if (!result.ok) this.clear();
        return result;
      } catch (error) {
        this.clear();
        throw error;
      }
    }
    const startedRevision = this.revision;
    const session = await this.session().catch(() => {
      this.clear();
      return null;
    });
    if (!current() || startedRevision !== this.revision || !this.foreground) {
      return { ok: false, error: { kind: "no_session" } };
    }
    if (
      session?.user.id !== options.expectedUserId ||
      session.user.id !== this.principal
    ) {
      this.clear();
      this.token = null;
      return { ok: false, error: { kind: "no_session" } };
    }
    if (this.token !== session.accessToken) {
      if (this.token !== null) this.clear();
      this.token = session.accessToken;
    }
    const revision = this.revision;
    const valid = () =>
      current() &&
      this.foreground &&
      revision === this.revision &&
      this.principal === options.expectedUserId;
    const cached = this.entries.get(key);
    if (
      cached &&
      cached.expiresAt > Date.now() &&
      cached.schema === options.schema
    ) {
      const parsed = options.schema!.safeParse(cached.value);
      if (parsed.success && valid()) {
        if (typeof parsed.data === "object" && parsed.data !== null)
          deadlines.set(parsed.data, cached.expiresAt);
        return { ok: true, value: parsed.data as T };
      }
      this.clear();
      return { ok: false, error: { kind: "validation_error", issues: [] } };
    }
    let pending = this.pending.get(key);
    if (
      !pending ||
      pending.revision !== revision ||
      pending.expiresAt <= Date.now() ||
      pending.schema !== options.schema
    ) {
      const scopes = new Set([valid]);
      const expiresAt = Date.now() + COMMUNITY_READ_LIFETIME_MS;
      const work: Pending = {
        scopes,
        expiresAt,
        revision,
        schema: options.schema,
        promise: Promise.resolve({ ok: false, error: { kind: "no_session" } }),
      };
      this.pending.set(key, work);
      work.promise = this.raw
        .request({
          ...options,
          isCurrent: () =>
            revision === this.revision &&
            this.foreground &&
            [...scopes].some((scope) => scope()),
        })
        .then((result) => {
          if (this.pending.get(key) === work) this.pending.delete(key);
          if (
            revision !== this.revision ||
            !this.foreground ||
            ![...scopes].some((scope) => scope())
          )
            return {
              ok: false as const,
              error: { kind: "no_session" as const },
            };
          if (!result.ok) {
            this.clear();
            return result;
          }
          if (expiresAt <= Date.now())
            return {
              ok: false as const,
              error: { kind: "no_session" as const },
            };
          if (typeof result.value === "object" && result.value !== null)
            deadlines.set(result.value, expiresAt);
          const parsed = options.schema!.safeParse(result.value);
          const bytes =
            JSON.stringify(result.value)?.length ?? MAX_ENTRY_BYTES + 1;
          if (parsed.success && bytes <= MAX_ENTRY_BYTES) {
            if (this.entries.size >= MAX_ENTRIES) {
              const oldest = this.entries.keys().next().value!;
              clearTimeout(this.entries.get(oldest)!.timer);
              this.entries.delete(oldest);
            }
            const timer = setTimeout(
              () => this.entries.delete(key),
              Math.max(0, expiresAt - Date.now()),
            );
            if (typeof timer === "object") timer.unref?.();
            const previous = this.entries.get(key);
            if (previous) clearTimeout(previous.timer);
            this.entries.set(key, {
              value: parsed.data,
              schema: options.schema,
              expiresAt,
              timer,
            });
          }
          return result;
        })
        .catch((error) => {
          if (revision === this.revision) this.clear();
          throw error;
        });
      pending = work;
    } else pending.scopes.add(valid);
    const result = await pending.promise;
    if (!valid()) return { ok: false, error: { kind: "no_session" } };
    return result as Result<T, ApiError>;
  }
}
