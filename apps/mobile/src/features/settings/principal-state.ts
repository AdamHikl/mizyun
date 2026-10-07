import type { ApiError } from "@mizyun/api-client";
import type { AuthPrincipalWire } from "@mizyun/contracts";

/**
 * Discriminated render state for the settings screen.
 *
 * Kept as a pure data union (no React types) so the reducer that
 * produces it can be exercised in vitest without pulling in the
 * React Native runtime through the screen module.
 */
export type PrincipalRenderState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly principal: AuthPrincipalWire }
  | { readonly kind: "disabled"; readonly reason: string }
  | { readonly kind: "no_session" }
  | { readonly kind: "session_expired" }
  | { readonly kind: "network_error"; readonly message: string }
  | {
      readonly kind: "server_error";
      readonly status: number;
      readonly message: string;
    }
  | { readonly kind: "unexpected"; readonly message: string };

/**
 * Reduce a `Result<AuthPrincipalWire, ApiError>` plus the auth/client
 * configuration flags into a renderable state. Pure: no I/O, no
 * React, no `process.env`. The settings screen calls this on every
 * refresh so the same logic is exercised by both the rendered UI and
 * the unit test.
 */
export const reducePrincipalState = (input: {
  readonly apiConfigured: boolean;
  readonly authConfigured: boolean;
  readonly authDisabledReason: string;
  readonly apiDisabledReason: string;
  readonly result?:
    | { readonly ok: true; readonly value: AuthPrincipalWire }
    | { readonly ok: false; readonly error: ApiError };
}): PrincipalRenderState => {
  if (!input.authConfigured) {
    return { kind: "disabled", reason: input.authDisabledReason };
  }
  if (!input.apiConfigured) {
    return { kind: "disabled", reason: input.apiDisabledReason };
  }
  if (!input.result) return { kind: "loading" };
  if (input.result.ok) {
    return { kind: "ready", principal: input.result.value };
  }
  switch (input.result.error.kind) {
    case "context_changed":
      return {
        kind: "unexpected",
        message:
          "This request is no longer current. Refresh your account details.",
      };
    case "no_session":
      return { kind: "no_session" };
    case "session_expired":
      return { kind: "session_expired" };
    case "network_error":
      return {
        kind: "network_error",
        message:
          input.result.error.cause instanceof Error
            ? input.result.error.cause.message
            : "Network request failed.",
      };
    case "http_error":
      return {
        kind: "server_error",
        status: input.result.error.status,
        message: input.result.error.message,
      };
    case "not_configured":
      return { kind: "disabled", reason: input.result.error.reason };
    case "validation_error":
      return {
        kind: "unexpected",
        message: "The API returned an unexpected response shape.",
      };
    case "parse_error":
      return {
        kind: "unexpected",
        message: "The API returned a body we could not parse.",
      };
  }
};
