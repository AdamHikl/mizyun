import type { Result } from "@mizyun/core";
import { err, ok } from "@mizyun/core";
import type { AuthConfigurationStatus } from "@mizyun/identity";
import { z } from "zod";

import { type ConfigIssue, formatConfigIssue } from "./errors";
import {
  PUBLIC_ENV_PREFIX,
  type EnvSnapshot,
  envSnapshotFrom,
  isPublicEnvKey,
} from "./env";

/**
 * Closed-world allowlist of `EXPO_PUBLIC_*` keys the mobile bundle may
 * consume. The loader reads ONLY these keys from the environment snapshot;
 * any other public or private key present is reported as `unexpected`.
 *
 * Why a tuple and not an array: TypeScript narrows string-literal elements
 * in `as const`, which keeps the test for "no superset leak" statically
 * checkable. Adding a key requires explicitly appending it here, which makes
 * the safety rule auditable in code review.
 */
export const ALLOWED_MOBILE_PUBLIC_KEYS = [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_API_URL",
] as const;

export type AllowedMobilePublicKey =
  (typeof ALLOWED_MOBILE_PUBLIC_KEYS)[number];

export interface MobileSupabaseConfiguration {
  readonly url: string;
  readonly publishableKey: string;
}

export interface MobileConfig {
  /**
   * Provider-neutral status of the Supabase configuration. When
   * `configured === true`, `supabaseConfig` carries the typed URL/key
   * pair so the mobile composition root does not need to re-read
   * `process.env`.
   */
  readonly supabase: AuthConfigurationStatus;
  readonly supabaseConfig: MobileSupabaseConfiguration | null;
  /**
   * Public base URL of the Mizyun API. Null when not provided; UI surfaces
   * should render an empty-state configuration-required message in that
   * case (mirroring the disabled-auth-client flow).
   */
  readonly apiUrl: string | null;
}

export type MobileConfigResult = Result<MobileConfig, readonly ConfigIssue[]>;

const DISABLED_REASON = "Supabase public configuration has not been provided.";

const apiUrlSchema = z
  .string()
  .url("EXPO_PUBLIC_API_URL must be a valid URL")
  .nullable();

const parseSupabasePair = (
  snapshot: EnvSnapshot,
): {
  readonly url: string | null;
  readonly publishableKey: string | null;
  readonly issues: readonly ConfigIssue[];
} => {
  const issues: ConfigIssue[] = [];
  const urlRaw = snapshot["EXPO_PUBLIC_SUPABASE_URL"];
  const keyRaw = snapshot["EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];

  const url = typeof urlRaw === "string" && urlRaw.length > 0 ? urlRaw : null;
  const publishableKey =
    typeof keyRaw === "string" && keyRaw.length > 0 ? keyRaw : null;

  if (url !== null) {
    const parsed = z.string().url().safeParse(url);
    if (!parsed.success) {
      issues.push({
        kind: "malformed",
        key: "EXPO_PUBLIC_SUPABASE_URL",
        reason: parsed.error.issues[0]?.message ?? "must be a valid URL",
      });
    }
  }
  if (publishableKey !== null && publishableKey.length === 0) {
    issues.push({
      kind: "malformed",
      key: "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      reason: "must not be empty",
    });
  }

  return { url, publishableKey, issues };
};

const findUnexpectedKeys = (snapshot: EnvSnapshot): readonly string[] => {
  const allowed = new Set<string>(ALLOWED_MOBILE_PUBLIC_KEYS);
  return Object.keys(snapshot).filter(
    (key) =>
      // Defence in depth: every key the loader is asked to consider must
      // either be in the allowlist, or we report it as unexpected.
      !allowed.has(key),
  );
};

/**
 * Validate a mobile environment snapshot. The closed-world allowlist is the
 * critical safety rule: only `EXPO_PUBLIC_*` keys in
 * `ALLOWED_MOBILE_PUBLIC_KEYS` are consumed; everything else is reported as
 * `unexpected` so a future contributor cannot accidentally inject a secret
 * (e.g. `SUPABASE_SECRET_KEY`) into the bundle or into a test snapshot.
 *
 * Returns `ok(MobileConfig)` when all known keys are absent, present-and-
 * valid, or only allowlisted. Returns `err(ConfigIssue[])` otherwise.
 */
export const loadMobileConfig = (
  input: { env?: EnvSnapshot } = {},
): MobileConfigResult => {
  const snapshot = input.env ?? envSnapshotFrom(process.env);

  // Closed-world enforcement: report any key not on the allowlist. This is
  // independent of validation, so it fires for both `EXPO_PUBLIC_*` keys we
  // do not know and any non-`EXPO_PUBLIC_*` key the caller passed in.
  const unexpected = findUnexpectedKeys(snapshot);
  const issues: ConfigIssue[] = [];
  if (unexpected.length > 0) {
    issues.push({ kind: "unexpected", keys: unexpected });
  }

  // Per-field validation for allowlisted keys.
  const pair = parseSupabasePair(snapshot);
  issues.push(...pair.issues);

  let apiUrlValue: string | null = null;
  const apiUrlRaw = snapshot["EXPO_PUBLIC_API_URL"];
  if (typeof apiUrlRaw === "string" && apiUrlRaw.length > 0) {
    const parsed = apiUrlSchema.safeParse(apiUrlRaw);
    if (parsed.success) {
      apiUrlValue = parsed.data;
    } else {
      issues.push({
        kind: "malformed",
        key: "EXPO_PUBLIC_API_URL",
        reason: parsed.error.issues[0]?.message ?? "must be a valid URL",
      });
    }
  }

  if (issues.length > 0) {
    return err(issues);
  }

  // The Supabase pair must be either both present or both absent — same
  // invariant as the server loader.
  const bothPresent = pair.url !== null && pair.publishableKey !== null;
  const bothAbsent = pair.url === null && pair.publishableKey === null;
  if (!bothPresent && !bothAbsent) {
    return err([
      {
        kind: "malformed",
        key: "EXPO_PUBLIC_SUPABASE_URL",
        reason:
          "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set together or both omitted.",
      },
    ]);
  }

  const supabase: AuthConfigurationStatus =
    bothPresent && pair.url && pair.publishableKey
      ? { configured: true, provider: "supabase" }
      : { configured: false, provider: "supabase", reason: DISABLED_REASON };

  const supabaseConfig: MobileSupabaseConfiguration | null =
    bothPresent && pair.url && pair.publishableKey
      ? { url: pair.url, publishableKey: pair.publishableKey }
      : null;

  return ok({ supabase, supabaseConfig, apiUrl: apiUrlValue });
};

/**
 * Convenience for the mobile composition root. Returns the typed result;
 * logs each issue on failure so simulators and CI show actionable output.
 */
export const loadMobileConfigOrLog = (
  input: { env?: EnvSnapshot } = {},
): MobileConfigResult => {
  const result = loadMobileConfig(input);
  if (!result.ok) {
    for (const issue of result.error) {
      // eslint-disable-next-line no-console
      console.error(`[config] ${formatConfigIssue(issue)}`);
    }
  }
  return result;
};

export { PUBLIC_ENV_PREFIX, isPublicEnvKey };
export type { EnvSnapshot };
