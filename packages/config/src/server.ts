import type { Result } from "@mizyun/core";
import { err, ok } from "@mizyun/core";
import type { AuthConfigurationStatus } from "@mizyun/identity";
import { z } from "zod";

import { type ConfigIssue, formatConfigIssue } from "./errors";
import { type EnvSnapshot, envSnapshotFrom } from "./env";

export type NodeEnv = "development" | "test" | "production";

/**
 * Validated server configuration. The composition root receives this shape
 * (or a list of `ConfigIssue`s) — it never sees raw `process.env` again.
 *
 * `supabase` is intentionally typed as `AuthConfigurationStatus` (the same
 * discriminated union the identity package returns from `AuthClient.status()`)
 * so the mobile and server composition roots render identical disabled
 * states from the same data shape.
 */
export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly env: NodeEnv;
  readonly supabase: AuthConfigurationStatus;
  /**
   * Typed Supabase server configuration. Non-null only when
   * `supabase.configured === true`; null otherwise. The composition root
   * does not need to re-read `process.env` after construction.
   */
  readonly supabaseConfig: ServerSupabaseConfiguration | null;
  readonly agentProvider: "disabled" | "configured";
}

export interface ServerSupabaseConfiguration {
  readonly url: string;
  readonly publishableKey: string;
}

export type ServerConfigResult = Result<ServerConfig, readonly ConfigIssue[]>;

/**
 * Node-style environment keys the server loader recognises. Exposed so tests
 * can build snapshots without hardcoding strings. The mobile loader keeps its
 * own list because its closed-world semantics differ.
 */
export const SERVER_ENV_KEYS = {
  host: "API_HOST",
  port: "API_PORT",
  env: "NODE_ENV",
  supabaseUrl: "SUPABASE_URL",
  supabasePublishableKey: "SUPABASE_PUBLISHABLE_KEY",
  agentProvider: "AGENT_PROVIDER",
} as const;

const DISABLED_REASON = "Supabase server configuration has not been provided.";

const baseServerSchema = z.object({
  env: z.enum(["development", "test", "production"]).default("development"),
  host: z.string().min(1, "API_HOST must not be empty").default("127.0.0.1"),
  port: z.coerce
    .number()
    .int("API_PORT must be an integer")
    .min(1, "API_PORT must be >= 1")
    .max(65535, "API_PORT must be <= 65535")
    .default(4000),
  supabaseUrl: z.string().url("SUPABASE_URL must be a valid URL").nullish(),
  supabasePublishableKey: z
    .string()
    .min(1, "SUPABASE_PUBLISHABLE_KEY must not be empty")
    .nullish(),
  agentProvider: z.enum(["disabled", "configured"]).default("disabled"),
});

type BaseServerShape = Record<
  | "env"
  | "host"
  | "port"
  | "supabaseUrl"
  | "supabasePublishableKey"
  | "agentProvider",
  string | undefined
>;

const readString = (snapshot: EnvSnapshot, key: string): string | undefined => {
  const value = snapshot[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const collectRawServerInput = (snapshot: EnvSnapshot): BaseServerShape => {
  const input: BaseServerShape = {
    env: undefined,
    host: undefined,
    port: undefined,
    supabaseUrl: undefined,
    supabasePublishableKey: undefined,
    agentProvider: undefined,
  };
  const host = readString(snapshot, SERVER_ENV_KEYS.host);
  if (host !== undefined) input.host = host;
  const port = readString(snapshot, SERVER_ENV_KEYS.port);
  if (port !== undefined) input.port = port;
  const env = readString(snapshot, SERVER_ENV_KEYS.env);
  if (env !== undefined) input.env = env;
  const url = readString(snapshot, SERVER_ENV_KEYS.supabaseUrl);
  if (url !== undefined) input.supabaseUrl = url;
  const key = readString(snapshot, SERVER_ENV_KEYS.supabasePublishableKey);
  if (key !== undefined) input.supabasePublishableKey = key;
  const provider = readString(snapshot, SERVER_ENV_KEYS.agentProvider);
  if (provider !== undefined) input.agentProvider = provider;
  return input;
};

/**
 * Map a schema field name back to its public env var name so the message
 * surfaces what the user actually set. Unknown field names fall through
 * unchanged — that's a useful signal that something is off in the schema.
 */
const schemaFieldToEnvKey = (field: string): string => {
  switch (field) {
    case "host":
      return SERVER_ENV_KEYS.host;
    case "port":
      return SERVER_ENV_KEYS.port;
    case "env":
      return SERVER_ENV_KEYS.env;
    case "supabaseUrl":
      return SERVER_ENV_KEYS.supabaseUrl;
    case "supabasePublishableKey":
      return SERVER_ENV_KEYS.supabasePublishableKey;
    case "agentProvider":
      return SERVER_ENV_KEYS.agentProvider;
    default:
      return field;
  }
};

const zodIssuesToConfigIssues = (
  issues: z.ZodIssue[],
): readonly ConfigIssue[] =>
  issues.map((issue): ConfigIssue => {
    const rawField = issue.path.length > 0 ? String(issue.path[0]) : "<root>";
    const key = schemaFieldToEnvKey(rawField);

    // Integer failures from `z.coerce.number().int()` surface as
    // `invalid_type` with `expected: "integer"`; range failures
    // (`.min`/`.max()`) surface as `too_small` / `too_big`. Both should be
    // reported as `out_of_range` so the UI distinguishes "wrong shape"
    // from "value out of bounds".
    const isRange =
      issue.code === z.ZodIssueCode.too_small ||
      issue.code === z.ZodIssueCode.too_big ||
      (issue.code === z.ZodIssueCode.invalid_type &&
        "expected" in issue &&
        (issue.expected === "integer" || issue.expected === "number"));

    if (isRange) {
      return { kind: "out_of_range", key, reason: issue.message };
    }
    return { kind: "malformed", key, reason: issue.message };
  });

/**
 * Validate a server environment snapshot. Returns `ok(ServerConfig)` when
 * every required-with-default key is present (or has a default) and every
 * present value passes shape validation. Returns `err(ConfigIssue[])` with
 * every malformed/out-of-range/asymmetric value reported together.
 *
 * This function is pure: it does not read `process.env` unless `env` is
 * omitted, and it does not call `process.exit`. The composition root decides
 * what to do on failure.
 */
export const loadServerConfig = (
  input: { env?: EnvSnapshot } = {},
): ServerConfigResult => {
  const snapshot = input.env ?? envSnapshotFrom(process.env);
  const raw = collectRawServerInput(snapshot);

  // Asymmetry check runs on the raw snapshot so a partial Supabase
  // configuration is reported alongside any other issue (e.g. a bad
  // API_PORT) in a single envelope.
  const supabaseUrlRaw = readString(snapshot, SERVER_ENV_KEYS.supabaseUrl);
  const supabaseKeyRaw = readString(
    snapshot,
    SERVER_ENV_KEYS.supabasePublishableKey,
  );
  const bothPresent =
    supabaseUrlRaw !== undefined && supabaseKeyRaw !== undefined;
  const bothAbsent =
    supabaseUrlRaw === undefined && supabaseKeyRaw === undefined;

  const parsed = baseServerSchema.safeParse(raw);
  const zodIssues: readonly ConfigIssue[] = parsed.success
    ? []
    : zodIssuesToConfigIssues(parsed.error.issues);

  if (!bothPresent && !bothAbsent) {
    return err([
      ...zodIssues,
      {
        kind: "malformed",
        key: SERVER_ENV_KEYS.supabaseUrl,
        reason:
          "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set together or both omitted.",
      },
    ]);
  }

  if (zodIssues.length > 0) {
    return err(zodIssues);
  }

  if (!parsed.success) {
    // Unreachable — handled above — but TypeScript needs the narrowing.
    return err(zodIssues);
  }

  const value = parsed.data;
  const url = value.supabaseUrl ?? null;
  const publishableKey = value.supabasePublishableKey ?? null;

  const supabase: AuthConfigurationStatus =
    url !== null && publishableKey !== null
      ? { configured: true, provider: "supabase" }
      : { configured: false, provider: "supabase", reason: DISABLED_REASON };

  const supabaseConfig: ServerSupabaseConfiguration | null =
    url !== null && publishableKey !== null ? { url, publishableKey } : null;

  return ok({
    env: value.env,
    host: value.host,
    port: value.port,
    supabase,
    supabaseConfig,
    agentProvider: value.agentProvider,
  });
};

/**
 * Convenience for the API composition root's `buildApp` / `listen` boundary.
 * Logs every issue to stderr with a stable code and returns the typed result
 * so the caller can choose to exit, fall back, or render a UI.
 */
export const loadServerConfigOrLog = (
  input: { env?: EnvSnapshot } = {},
): ServerConfigResult => {
  const result = loadServerConfig(input);
  if (!result.ok) {
    for (const issue of result.error) {
      // eslint-disable-next-line no-console
      console.error(`[config] ${formatConfigIssue(issue)}`);
    }
  }
  return result;
};
