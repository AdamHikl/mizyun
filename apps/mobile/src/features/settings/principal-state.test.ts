import { describe, expect, it } from "vitest";

import { reducePrincipalState } from "./principal-state";

const baseInput = {
  apiConfigured: true,
  authConfigured: true,
  authDisabledReason: "auth missing",
  apiDisabledReason: "api missing",
} as const;

describe("reducePrincipalState", () => {
  it("returns disabled when auth is not configured", () => {
    const state = reducePrincipalState({
      ...baseInput,
      authConfigured: false,
      authDisabledReason: "no supabase",
    });
    expect(state).toEqual({ kind: "disabled", reason: "no supabase" });
  });

  it("returns disabled when api is not configured even if auth is", () => {
    const state = reducePrincipalState({
      ...baseInput,
      apiConfigured: false,
      apiDisabledReason: "no api url",
    });
    expect(state).toEqual({ kind: "disabled", reason: "no api url" });
  });

  it("returns loading when no result is available yet", () => {
    expect(reducePrincipalState({ ...baseInput })).toEqual({
      kind: "loading",
    });
  });

  it("returns ready when the request succeeded", () => {
    const principal = {
      userId: "00000000-0000-4000-8000-000000000001",
      email: "alice@example.com",
    };
    const state = reducePrincipalState({
      ...baseInput,
      result: { ok: true, value: principal },
    });
    expect(state).toEqual({ kind: "ready", principal });
  });

  it("maps no_session to no_session", () => {
    const state = reducePrincipalState({
      ...baseInput,
      result: { ok: false, error: { kind: "no_session" } },
    });
    expect(state).toEqual({ kind: "no_session" });
  });

  it("maps session_expired to session_expired", () => {
    const state = reducePrincipalState({
      ...baseInput,
      result: { ok: false, error: { kind: "session_expired" } },
    });
    expect(state).toEqual({ kind: "session_expired" });
  });

  it("maps network_error to a readable message when the cause has one", () => {
    const cause = new Error("connection refused");
    const state = reducePrincipalState({
      ...baseInput,
      result: { ok: false, error: { kind: "network_error", cause } },
    });
    expect(state).toEqual({
      kind: "network_error",
      message: "connection refused",
    });
  });

  it("falls back to a generic network_error message when the cause has none", () => {
    const state = reducePrincipalState({
      ...baseInput,
      result: { ok: false, error: { kind: "network_error", cause: "weird" } },
    });
    expect(state).toEqual({
      kind: "network_error",
      message: "Network request failed.",
    });
  });

  it("maps http_error to server_error with status and message", () => {
    const state = reducePrincipalState({
      ...baseInput,
      result: {
        ok: false,
        error: {
          kind: "http_error",
          status: 503,
          code: "MAINTENANCE",
          message: "down for maintenance",
        },
      },
    });
    expect(state).toEqual({
      kind: "server_error",
      status: 503,
      message: "down for maintenance",
    });
  });

  it("maps not_configured to disabled with the supplied reason", () => {
    const state = reducePrincipalState({
      ...baseInput,
      result: {
        ok: false,
        error: { kind: "not_configured", reason: "no api url" },
      },
    });
    expect(state).toEqual({ kind: "disabled", reason: "no api url" });
  });

  it("maps validation_error to unexpected with a fixed message", () => {
    const state = reducePrincipalState({
      ...baseInput,
      result: {
        ok: false,
        error: { kind: "validation_error", issues: [] },
      },
    });
    expect(state).toEqual({
      kind: "unexpected",
      message: "The API returned an unexpected response shape.",
    });
  });

  it("maps parse_error to unexpected with a fixed message", () => {
    const state = reducePrincipalState({
      ...baseInput,
      result: { ok: false, error: { kind: "parse_error", cause: {} } },
    });
    expect(state).toEqual({
      kind: "unexpected",
      message: "The API returned a body we could not parse.",
    });
  });
});
