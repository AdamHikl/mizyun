import { err, ok, type Result } from "@mizyun/core";
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
  readonly getExtraHeaders?: () => Record<string, string>;
}

const AUTHORIZATION_HEADER = "authorization";
const CONTENT_TYPE_HEADER = "content-type";
const JSON_CONTENT_TYPE = "application/json";

const isAbsoluteUrl = (path: string): boolean => /^https?:\/\//i.test(path);

const trimTrailingSlash = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;

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
  readonly #getExtraHeaders: (() => Record<string, string>) | undefined;

  constructor(dependencies: HttpApiClientDependencies) {
    this.#baseUrl = trimTrailingSlash(dependencies.baseUrl);
    this.#authClient = dependencies.authClient;
    this.#fetch = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.#getExtraHeaders = dependencies.getExtraHeaders;
  }

  status(): ApiConfigurationStatus {
    return { configured: true, baseUrl: this.#baseUrl };
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
    if (!session) {
      return err({ kind: "no_session" });
    }

    const extra = this.#getExtraHeaders?.() ?? {};
    const headers: Record<string, string> = {
      ...(options.body !== undefined
        ? { [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE }
        : {}),
      ...extra,
      ...(options.headers ?? {}),
    };
    headers[AUTHORIZATION_HEADER] = `Bearer ${session.accessToken}`;

    const url = `${this.#baseUrl}${options.path}`;
    const body =
      options.body !== undefined ? JSON.stringify(options.body) : undefined;

    // TEMP DEBUG (AI-MOB-002 instrumentation round 1): log every
    // outgoing request + status. Visible in Xcode's device console
    // so we can confirm the iPhone is actually reaching the API.
    // eslint-disable-next-line no-console
    console.log(
      `[mizyun-api] → ${options.method} ${url}` +
        (body !== undefined ? ` body=${body.slice(0, 200)}` : ""),
    );

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: options.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (cause) {
      // eslint-disable-next-line no-console
      console.log(`[mizyun-api] ✗ network error: ${String(cause)}`);
      return err(mapFetchError(cause));
    }

    // eslint-disable-next-line no-console
    console.log(`[mizyun-api] ← ${response.status} ${options.method} ${url}`);

    if (response.status === 401) {
      // Fire-and-forget: the existing AuthContext subscribe path will
      // surface the cleared session. Awaiting here would couple the
      // request lifecycle to a network call we have no use for.
      void this.#authClient.signOut().catch(() => {
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
