import {
  createMealRecipeSessionTransport,
  type MealRecipeSessionApi,
} from "./meal-recipe-session-api";
import { err, ok, type Result } from "@mizyun/core";
import {
  API_COMPAT_HEADER,
  API_COMPAT_VERSION,
  DEVICE_TIME_ZONE_HEADER,
  coachMessageResponseSchema,
  foodDraftResponseSchema,
  mealIllustrationResponseSchema,
  mealIllustrationCapabilitySchema,
  type MealIllustrationResponse,
  type MealIllustrationCapability,
  type CoachMessageResponse,
  type FoodDraftResponse,
} from "@mizyun/contracts";
import type { AuthClient } from "@mizyun/identity";

import {
  createMealRecipeTransport,
  type MealRecipeApi,
} from "./meal-recipe-api";
import type { ApiClient } from "./api-client";
import { mapFetchError, parseApiErrorBody } from "./errors";
import type {
  ApiConfigurationStatus,
  ApiError,
  NotModifiedResult,
  RequestOptions,
  RevalidationMetadata,
} from "./types";

/**
 * Injectable dependencies for `HttpApiClient`. Tests substitute `fetch` with
 * a `vi.fn()`. The `authClient` is required — every request reads the
 * current access token via `getSession()`.
 */
export interface HttpApiClientDependencies {
  readonly baseUrl: string;
  readonly authClient: AuthClient;
  readonly fetch?: typeof globalThis.fetch;
  /** Device IANA zone sent with each request; defaults to the runtime's. */
  readonly deviceTimeZone?: () => string | null;
}

const AUTHORIZATION_HEADER = "authorization";
const CONTENT_TYPE_HEADER = "content-type";
const JSON_CONTENT_TYPE = "application/json";

/** The runtime's current IANA zone, or null when it cannot report one. */
const runtimeTimeZone = (): string | null => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

/**
 * Adds the client capability header to every request this client sends, so
 * the server can tell current clients from installed legacy builds, and the
 * device zone (REL-01), read per request because the phone can change zone
 * while the app runs.
 */
const withCompatHeader =
  (
    fetcher: typeof globalThis.fetch,
    deviceTimeZone: () => string | null = runtimeTimeZone,
  ): typeof globalThis.fetch =>
  (input, init) => {
    const extra: Array<[string, string]> = [
      [API_COMPAT_HEADER, API_COMPAT_VERSION],
    ];
    const zone = deviceTimeZone();
    if (zone) extra.push([DEVICE_TIME_ZONE_HEADER, zone]);
    const headers = init?.headers;
    let next: NonNullable<NonNullable<typeof init>["headers"]>;
    if (headers instanceof Headers) {
      const copy = new Headers(headers);
      for (const [name, value] of extra) copy.set(name, value);
      next = copy;
    } else if (Array.isArray(headers)) {
      next = [...headers, ...extra];
    } else {
      next = { ...(headers ?? {}), ...Object.fromEntries(extra) };
    }
    return fetcher(input, { ...(init ?? {}), headers: next });
  };

// Exact casing matters on iOS: React Native's RCTNetworking checks
// `allHTTPHeaderFields[@"If-None-Match"]` to bypass the local URL cache so
// the 304 reaches JavaScript.
const IF_NONE_MATCH_HEADER = "If-None-Match";
const ETAG_HEADER = "etag";
const MAX_ETAG_LENGTH = 256;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

const usableEtag = (value: string | null | undefined): string | undefined =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_ETAG_LENGTH &&
  PRINTABLE_ASCII.test(value)
    ? value
    : undefined;

/** Opaque part of an entity tag, for the weak comparison of RFC 9110 §8.8.3.2. */
const opaqueTag = (tag: string): string => tag.trim().replace(/^W\//, "");

const readEtag = (response: Response): string | undefined => {
  try {
    return usableEtag(response.headers?.get(ETAG_HEADER));
  } catch {
    return undefined;
  }
};

/** True when a `request` result is a 304 answer to `ifNoneMatch`. */
export const isNotModified = (result: unknown): result is NotModifiedResult =>
  typeof result === "object" &&
  result !== null &&
  (result as { ok?: unknown }).ok === true &&
  (result as RevalidationMetadata).notModified === true;

/** The validated `ETag` of a successful 200 `request` result, if any. */
export const resultEtag = (result: unknown): string | undefined =>
  typeof result === "object" &&
  result !== null &&
  (result as { ok?: unknown }).ok === true
    ? usableEtag((result as RevalidationMetadata).etag)
    : undefined;

const isAbsoluteUrl = (path: string): boolean => /^https?:\/\//i.test(path);

const trimTrailingSlash = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;

const mimeExt = (mime: "image/jpeg" | "image/png" | "image/webp"): string => {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
  }
};

/**
 * Real `fetch`-backed API client. Attaches the bearer token from
 * `authClient.getSession()`, normalizes 4xx/5xx to `kind: "http_error"`
 * (or `kind: "parse_error"` if the body does not match `apiErrorSchema`),
 * runs the optional Zod schema on 2xx responses, and surfaces `fetch`
 * rejections as `kind: "network_error"`.
 *
 * On 401, the client fires `authClient.signOut()` (fire-and-forget) and
 * returns `kind: "session_expired"`. The sign-out is intentional: a
 * server-rejected token must not be reused, and the existing
 * `AuthContext` will flip the UI to the sign-in screen via its
 * `subscribe(...)` path.
 */
export class HttpApiClient implements ApiClient {
  readonly #baseUrl: string;
  readonly #authClient: AuthClient;
  readonly #fetch: typeof globalThis.fetch;
  readonly getMealRecipeSessionContext: MealRecipeSessionApi["context"];
  readonly revalidateMealRecipes: MealRecipeSessionApi["revalidate"];
  readonly getMealRecipeCapabilities: MealRecipeApi["capabilities"];
  readonly suggestMealRecipes: MealRecipeApi["suggest"];
  readonly recognizeMealRecipeIngredients: MealRecipeApi["recognizeIngredients"];
  readonly assistMealRecipe: MealRecipeApi["assist"];

  constructor(dependencies: HttpApiClientDependencies) {
    this.#baseUrl = trimTrailingSlash(dependencies.baseUrl);
    this.#authClient = dependencies.authClient;
    this.#fetch = withCompatHeader(
      dependencies.fetch ?? globalThis.fetch.bind(globalThis),
      dependencies.deviceTimeZone,
    );
    const recipes = createMealRecipeTransport({
      ...dependencies,
      fetch: this.#fetch,
    });
    const recipeSession = createMealRecipeSessionTransport({
      ...dependencies,
      fetch: this.#fetch,
    });
    this.getMealRecipeSessionContext = recipeSession.context;
    this.revalidateMealRecipes = recipeSession.revalidate;
    this.getMealRecipeCapabilities = recipes.capabilities;
    this.suggestMealRecipes = recipes.suggest;
    this.recognizeMealRecipeIngredients = recipes.recognizeIngredients;
    this.assistMealRecipe = recipes.assist;
  }

  status(): ApiConfigurationStatus {
    return { configured: true, baseUrl: this.#baseUrl };
  }

  /**
   * VISION-001 — post a meal photo + optional text hint to the
   * vision workspace. The API returns a structured
   * candidate the user can edit before saving via
   * `request({ method: "POST", path: "/v1/food-entries", ... })`.
   *
   * `photo` is a native/web Blob (JPEG/PNG/WebP, ≤ 15 MiB);
   * `mimeType` must match the byte stream. The route never
   * persists the photo — bytes flow transient to the
   * provider and back.
   */
  async draftFoodEntry(input: {
    readonly photo: Blob;
    readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
    readonly additionalPhotos?: readonly {
      readonly photo: Blob;
      readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
    }[];
    readonly textHint?: string;
  }): Promise<Result<FoodDraftResponse, ApiError>> {
    if ((input.additionalPhotos?.length ?? 0) > 2) {
      return err({
        kind: "validation_error",
        issues: [
          {
            code: "custom",
            path: ["additionalPhotos"],
            message: "Choose up to 3 photos.",
          },
        ],
      });
    }
    const url = `${this.#baseUrl}/v1/food-entries/draft`;
    const session = await this.#authClient.getSession();
    if (!session) return err({ kind: "no_session" });

    const headers: Record<string, string> = {
      [AUTHORIZATION_HEADER]: `Bearer ${session.accessToken}`,
    };
    const body = new FormData();
    body.append("image", input.photo, `meal.${mimeExt(input.mimeType)}`);
    for (const [index, extra] of (input.additionalPhotos ?? []).entries()) {
      body.append(
        "image",
        extra.photo,
        `meal-${index + 2}.${mimeExt(extra.mimeType)}`,
      );
    }
    if (input.textHint !== undefined && input.textHint.trim().length > 0) {
      body.append("textHint", input.textHint.trim());
    }

    let response: Response;
    try {
      response = await this.#fetch(url, { method: "POST", headers, body });
    } catch (cause) {
      return err(mapFetchError(cause));
    }

    if (response.status === 401) {
      void this.#authClient.signOut(session).catch(() => {});
      return err({ kind: "session_expired" });
    }

    if (!response.ok) {
      let parsedBody: unknown;
      try {
        parsedBody = await response.json();
      } catch {
        parsedBody = undefined;
      }
      const mapped = parseApiErrorBody(parsedBody);
      if (!mapped.ok) {
        if (mapped.error.kind === "http_error") {
          return err({ ...mapped.error, status: response.status });
        }
        return err(mapped.error);
      }
      return err({
        kind: "http_error",
        status: response.status,
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      });
    }

    let parsedBody: unknown;
    try {
      parsedBody = await response.json();
    } catch (cause) {
      return err({ kind: "parse_error", cause });
    }
    const parsed = foodDraftResponseSchema.safeParse(parsedBody);
    if (!parsed.success) {
      return err({
        kind: "validation_error",
        issues: parsed.error.issues,
      });
    }
    return ok(parsed.data);
  }

  async draftCoachMealPhoto(input: {
    readonly conversationId: string;
    readonly idempotencyKey: string;
    readonly photo: Blob;
    readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
    readonly textHint?: string;
    readonly additionalPhotos?: readonly {
      readonly photo: Blob;
      readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
    }[];
  }): Promise<Result<CoachMessageResponse, ApiError>> {
    if ((input.additionalPhotos?.length ?? 0) > 2) {
      return err({
        kind: "validation_error",
        issues: [
          {
            code: "custom",
            path: ["additionalPhotos"],
            message: "Choose up to 3 photos.",
          },
        ],
      });
    }
    const path = `/v1/coach/conversations/${encodeURIComponent(
      input.conversationId,
    )}/nutrition-photo`;
    const session = await this.#authClient.getSession();
    if (!session) return err({ kind: "no_session" });
    const body = new FormData();
    body.append("image", input.photo, `meal.${mimeExt(input.mimeType)}`);
    for (const [index, extra] of (input.additionalPhotos ?? []).entries()) {
      body.append(
        "image",
        extra.photo,
        `meal-${index + 2}.${mimeExt(extra.mimeType)}`,
      );
    }
    if (input.textHint !== undefined && input.textHint.trim().length > 0) {
      body.append("textHint", input.textHint.trim());
    }
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: "POST",
        headers: {
          [AUTHORIZATION_HEADER]: `Bearer ${session.accessToken}`,
          "idempotency-key": input.idempotencyKey,
        },
        body,
      });
    } catch (cause) {
      return err(mapFetchError(cause));
    }
    if (response.status === 401) {
      void this.#authClient.signOut(session).catch(() => {});
      return err({ kind: "session_expired" });
    }
    if (!response.ok) {
      let parsedBody: unknown;
      try {
        parsedBody = await response.json();
      } catch {
        parsedBody = undefined;
      }
      const mapped = parseApiErrorBody(parsedBody);
      if (!mapped.ok) {
        if (mapped.error.kind === "http_error") {
          return err({ ...mapped.error, status: response.status });
        }
        return err(mapped.error);
      }
      return err({
        kind: "http_error",
        status: response.status,
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      });
    }
    let parsedBody: unknown;
    try {
      parsedBody = await response.json();
    } catch (cause) {
      return err({ kind: "parse_error", cause });
    }
    const parsed = coachMessageResponseSchema.safeParse(parsedBody);
    return parsed.success
      ? ok(parsed.data)
      : err({ kind: "validation_error", issues: parsed.error.issues });
  }

  async ensureMealIllustration(
    entryId: string,
    options: Partial<RequestOptions> = {},
  ): Promise<Result<MealIllustrationResponse, ApiError>> {
    return this.request({
      ...options,
      method: "POST",
      path: `/v1/food-entries/${encodeURIComponent(entryId)}/illustration`,
      body: undefined,
      schema: mealIllustrationResponseSchema,
    });
  }
  async getMealIllustrationCapability(
    options: Partial<RequestOptions> = {},
  ): Promise<Result<MealIllustrationCapability, ApiError>> {
    return this.request({
      ...options,
      method: "GET",
      path: "/v1/food-entries/illustrations/capability",
      body: undefined,
      schema: mealIllustrationCapabilitySchema,
    });
  }

  async request<T>(options: RequestOptions): Promise<Result<T, ApiError>> {
    if (isAbsoluteUrl(options.path)) {
      return err({
        kind: "parse_error",
        cause: new Error(
          `request path must be relative (got "${options.path}")`,
        ),
      });
    }

    const session = await this.#authClient.getSession();
    if (
      !session ||
      (options.expectedUserId !== undefined &&
        options.expectedUserId !== session.user.id) ||
      options.isCurrent?.() === false
    ) {
      return err({ kind: "no_session" });
    }

    const headers: Record<string, string> = {
      ...(options.body !== undefined
        ? { [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE }
        : {}),
      ...(options.headers ?? {}),
    };
    headers[AUTHORIZATION_HEADER] = `Bearer ${session.accessToken}`;
    const conditional =
      options.method === "GET" &&
      typeof options.ifNoneMatch === "string" &&
      options.ifNoneMatch.length > 0;
    if (conditional) {
      for (const name of Object.keys(headers)) {
        if (name.toLowerCase() === "if-none-match") delete headers[name];
      }
      headers[IF_NONE_MATCH_HEADER] = options.ifNoneMatch as string;
    }

    const url = `${this.#baseUrl}${options.path}`;
    const body =
      options.body !== undefined ? JSON.stringify(options.body) : undefined;

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: options.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (cause) {
      return err(mapFetchError(cause));
    }

    if (response.status === 401) {
      if (options.expectedUserId !== undefined) {
        // A reply from a retired account must not clear a newer session.
        const current = await this.#authClient.getSession().catch(() => null);
        if (
          !current ||
          current.user.id !== session.user.id ||
          current.accessToken !== session.accessToken ||
          options.isCurrent?.() === false
        ) {
          return err({ kind: "session_expired" });
        }
      }

      // Fire-and-forget: the existing AuthContext subscribe path will
      // surface the cleared session. Awaiting here would couple the
      // request lifecycle to a network call we have no use for.
      void this.#authClient.signOut(session).catch(() => {
        // Sign-out failure is non-fatal for the request — the local
        // session may already be gone.
      });
      return err({ kind: "session_expired" });
    }

    // RFC 9110 §15.4.5 — 304 has no content. It is success only as the
    // answer to our own If-None-Match; anything else is unexpected.
    if (response.status === 304) {
      if (conditional) {
        const notModified: NotModifiedResult = {
          ok: true,
          value: undefined,
          notModified: true,
        };
        return notModified as unknown as Result<T, ApiError>;
      }
      return err({
        kind: "http_error",
        status: 304,
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      });
    }

    // On iOS, expo/fetch uses the shared URLCache, which can merge a server
    // 304 into a response an older build cached for the same URL (possibly
    // for another account) and surface it as a 200. A 200 that names the tag
    // we sent is our held representation; a 200 without any tag cannot be
    // trusted as the server's answer, so ask once more without the validator.
    if (conditional && response.status === 200) {
      const tag = readEtag(response);
      if (tag === undefined) {
        void response.body?.cancel().catch(() => {});
        const { ifNoneMatch: _unused, ...unconditional } = options;
        return this.request<T>(unconditional);
      }
      if (opaqueTag(tag) === opaqueTag(options.ifNoneMatch as string)) {
        void response.body?.cancel().catch(() => {});
        const notModified: NotModifiedResult = {
          ok: true,
          value: undefined,
          notModified: true,
        };
        return notModified as unknown as Result<T, ApiError>;
      }
    }

    // RFC 9110 defines 204 as a successful response with no content.
    // Do not call response.json(): Fetch rejects when an empty body is
    // parsed, which would turn a successful DELETE into parse_error.
    if (response.ok && response.status === 204) {
      return ok(undefined as T);
    }

    let parsedBody: unknown;
    try {
      parsedBody = await response.json();
    } catch (cause) {
      // Some non-2xx responses have empty bodies; treat JSON parse failure
      // as a structural mismatch only when the status indicates an error.
      if (response.ok) {
        return err({ kind: "parse_error", cause });
      }
      return err({
        kind: "http_error",
        status: response.status,
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      });
    }

    if (!response.ok) {
      const mapped = parseApiErrorBody(parsedBody);
      if (mapped.ok) {
        // Unreachable — `parseApiErrorBody` always returns `err(...)`.
        return err({ kind: "parse_error", cause: "unexpected-ok" });
      }
      if (mapped.error.kind === "http_error") {
        // Re-emit with the real status code (parseApiErrorBody does not
        // know it; the response does).
        return err({ ...mapped.error, status: response.status });
      }
      return err(mapped.error);
    }

    if (options.schema) {
      const validated = options.schema.safeParse(parsedBody);
      if (!validated.success) {
        return err({
          kind: "validation_error",
          issues: validated.error.issues,
        });
      }
      return withEtag(ok(validated.data as T), readEtag(response));
    }

    return withEtag(ok(parsedBody as T), readEtag(response));
  }
}

const withEtag = <T>(
  result: Result<T, never>,
  etag: string | undefined,
): Result<T, ApiError> => {
  if (etag === undefined || !result.ok) return result;
  const tagged: Result<T, ApiError> & RevalidationMetadata = {
    ok: true,
    value: result.value,
    etag,
  };
  return tagged;
};
