import { createSupabaseMobileAuthClient } from "@mizyun/adapter-supabase-mobile";
import { DisabledAuthClient, type AuthClient } from "@mizyun/identity";

import { mobileConfigResult } from "./mobile-config";

/**
 * Mobile composition root for authentication. The validated
 * `loadMobileConfig` loader is the single source of truth for which
 * environment keys are allowed in the Expo bundle; the resulting
 * `AuthConfigurationStatus` is reused unchanged from `@mizyun/identity`
 * so the existing `AuthSetupScreen` keeps rendering the safe disabled
 * state without modification.
 */
const configResult = mobileConfigResult;

export const authConfiguration = configResult.ok
  ? configResult.value.supabase
  : // The mobile loader only returns `err(...)` when something is
    // malformed or unexpected. Treat that as the same "not configured"
    // state as a fully-missing snapshot — but prefer the loader's own
    // status when present.
    { configured: false as const, provider: "supabase", reason: "" };

/**
 * Concrete `AuthClient` selected for this composition. The mobile loader
 * guarantees that whenever `authConfiguration.configured === true`, the
 * accompanying `supabaseConfig` (URL + publishable key pair) is non-null
 * and individually valid, so the `if`-guard here only narrows the type.
 */
export const authClient: AuthClient =
  authConfiguration.configured &&
  configResult.ok &&
  configResult.value.supabaseConfig
    ? createSupabaseMobileAuthClient(configResult.value.supabaseConfig)
    : new DisabledAuthClient();
