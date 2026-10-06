import { err, ok, type Result } from "@mizyun/core";
import {
  coachMessageResponseSchema,
  foodDraftResponseSchema,
  type CoachMessageResponse,
  type FoodDraftResponse,
} from "@mizyun/contracts";
import type { AuthClient } from "@mizyun/identity";

import type { ApiClient } from "./api-client";
import { mapFetchError, parseApiErrorBody } from "./errors";
import type { ApiConfigurationStatus, ApiError, RequestOptions } from "./types";

/**
 * Injectable dependencies for `HttpApiClient`. Tests substitute `fetch` with
 * a `vi.fn()`. The `authClient` is required — every request reads the
 * current access token via `getSession()`.
 */
export interface HttpApiClientDependencies {
  readonly baseUrl: string;
  readonly authClient: AuthClient;
  readonly fetch?: typeof globalThis.fetch;
}

const AUTHORIZATION_HEADER = "authorization";
const CONTENT_TYPE_HEADER = "content-type";
const JSON_CONTENT_TYPE = "application/json";

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

  constructor(dependencies: HttpApiClientDependencies) {
    this.#baseUrl = trimTrailingSlash(dependencies.baseUrl);
    this.#authClient = dependencies.authClient;
    this.#fetch = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
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
      return ok(validated.data as T);
    }

    return ok(parsedBody as T);
  }
}
