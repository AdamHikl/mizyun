import type { Result } from "@mizyun/core";
import { err, ok } from "@mizyun/core";

import type { ConfigIssue } from "./errors";

export type MizyunAppVariant = "dev" | "production";
export type MizyunBuildProfile = "development" | "preview" | "production";

export interface MobileBuildIdentity {
  readonly variant: MizyunAppVariant;
  readonly profile: MizyunBuildProfile;
  readonly name: string;
  readonly slug: string;
  readonly scheme: string;
  readonly iosBundleIdentifier: string;
  readonly androidPackage: string;
}

export interface BuildMatrixValidationInput {
  readonly variant?: string | undefined;
  readonly profile?: string | undefined;
  readonly easProfile?: string | undefined;
  readonly apiUrl?: string | undefined;
  readonly supabaseUrl?: string | undefined;
  readonly authRedirectUri?: string | undefined;
}

export const BUILD_IDENTITIES: Record<
  MizyunAppVariant,
  Omit<MobileBuildIdentity, "profile">
> = {
  dev: {
    variant: "dev",
    name: "Mizyun Dev",
    slug: "mizyun-dev",
    scheme: "mizyun-dev",
    iosBundleIdentifier: "com.mizyun.development",
    androidPackage: "com.mizyun.dev",
  },
  production: {
    variant: "production",
    name: "Mizyun",
    slug: "mizyun",
    scheme: "mizyun",
    iosBundleIdentifier: "com.mizyun.app",
    androidPackage: "com.mizyun.app",
  },
};

const PROD_API_HOSTS = new Set(["mizyun-api.phiskel.com"]);
const PROD_SUPABASE_HOSTS = new Set(["mizyun-supabase.phiskel.com"]);
const DEV_API_HOSTS = new Set(["mizyun-api-dev.phiskel.com"]);
const DEV_SUPABASE_HOSTS = new Set(["mizyun-supabase-dev.phiskel.com"]);

const extractHostname = (urlString: string): string | null => {
  try {
    const url = new URL(urlString);
    return url.hostname;
  } catch {
    return null;
  }
};

/**
 * Validates the cross-field integrity of mobile build profiles, app variants,
 * native identities, and host endpoints (Finding Q3 / REL-AUD-003 / INFRA-DUAL-003).
 */
export const validateBuildMatrix = (
  input: BuildMatrixValidationInput,
): Result<MobileBuildIdentity, readonly ConfigIssue[]> => {
  const issues: ConfigIssue[] = [];

  // 1. Resolve Profile
  let profile: MizyunBuildProfile;
  if (input.profile) {
    if (
      input.profile !== "development" &&
      input.profile !== "preview" &&
      input.profile !== "production"
    ) {
      issues.push({
        kind: "malformed",
        key: "MIZYUN_BUILD_PROFILE",
        reason: `Unknown build profile "${input.profile}". Expected "development", "preview", or "production".`,
      });
      return err(issues);
    }
    profile = input.profile;
  } else if (input.easProfile) {
    if (
      input.easProfile !== "development" &&
      input.easProfile !== "preview" &&
      input.easProfile !== "production"
    ) {
      issues.push({
        kind: "malformed",
        key: "EAS_BUILD_PROFILE",
        reason: `Unknown EAS profile "${input.easProfile}". Expected "development", "preview", or "production".`,
      });
      return err(issues);
    }
    profile = input.easProfile;
  } else if (input.variant === "production") {
    profile = "production";
  } else {
    profile = "development";
  }

  // Cross-check explicit EAS_BUILD_PROFILE and MIZYUN_BUILD_PROFILE
  if (input.easProfile && input.profile && input.easProfile !== input.profile) {
    issues.push({
      kind: "malformed",
      key: "MIZYUN_BUILD_PROFILE",
      reason: `EAS profile "${input.easProfile}" conflicts with build profile "${input.profile}".`,
    });
  }

  // 2. Resolve Variant
  let variant: MizyunAppVariant;
  if (input.variant) {
    if (input.variant !== "dev" && input.variant !== "production") {
      issues.push({
        kind: "malformed",
        key: "MIZYUN_APP_VARIANT",
        reason: `Unknown app variant "${input.variant}". Expected "dev" or "production".`,
      });
      return err(issues);
    }
    variant = input.variant;
  } else {
    variant = profile === "production" ? "production" : "dev";
  }

  // 3. Matrix Cross-check: Profile vs Variant
  if (profile === "production" && variant !== "production") {
    issues.push({
      kind: "malformed",
      key: "MIZYUN_APP_VARIANT",
      reason: `Profile "${profile}" requires variant "production", but received variant "${variant}".`,
    });
  } else if (
    (profile === "development" || profile === "preview") &&
    variant !== "dev"
  ) {
    issues.push({
      kind: "malformed",
      key: "MIZYUN_APP_VARIANT",
      reason: `Profile "${profile}" requires variant "dev", but received variant "${variant}".`,
    });
  }

  // 4. Production Required Endpoints & Secrets
  if (profile === "production") {
    if (!input.apiUrl) {
      issues.push({
        kind: "missing",
        keys: ["EXPO_PUBLIC_API_URL"],
      });
    }
    if (!input.supabaseUrl) {
      issues.push({
        kind: "missing",
        keys: ["EXPO_PUBLIC_SUPABASE_URL"],
      });
    }
    if (!input.authRedirectUri) {
      issues.push({
        kind: "missing",
        keys: ["EXPO_PUBLIC_AUTH_REDIRECT_URI"],
      });
    }
  }

  // 5. Endpoint Host & Redirect URI Conflict Checks
  if (input.apiUrl) {
    const host = extractHostname(input.apiUrl);
    if (!host) {
      issues.push({
        kind: "malformed",
        key: "EXPO_PUBLIC_API_URL",
        reason: `Invalid API URL "${input.apiUrl}".`,
      });
    } else if (variant === "production") {
      if (!PROD_API_HOSTS.has(host)) {
        issues.push({
          kind: "malformed",
          key: "EXPO_PUBLIC_API_URL",
          reason: `Production variant cannot point to non-production API "${input.apiUrl}". Expected host "mizyun-api.phiskel.com".`,
        });
      }
    } else {
      const allowed =
        DEV_API_HOSTS.has(host) ||
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "10.0.2.2";
      if (!allowed) {
        issues.push({
          kind: "malformed",
          key: "EXPO_PUBLIC_API_URL",
          reason: `Dev variant "${variant}" cannot point to API host "${host}". Expected dev or local API host.`,
        });
      }
    }
  }

  if (input.supabaseUrl) {
    const host = extractHostname(input.supabaseUrl);
    if (!host) {
      issues.push({
        kind: "malformed",
        key: "EXPO_PUBLIC_SUPABASE_URL",
        reason: `Invalid Supabase URL "${input.supabaseUrl}".`,
      });
    } else if (variant === "production") {
      if (!PROD_SUPABASE_HOSTS.has(host)) {
        issues.push({
          kind: "malformed",
          key: "EXPO_PUBLIC_SUPABASE_URL",
          reason: `Production variant cannot point to non-production Supabase "${input.supabaseUrl}". Expected host "mizyun-supabase.phiskel.com".`,
        });
      }
    } else {
      const allowed =
        DEV_SUPABASE_HOSTS.has(host) ||
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "10.0.2.2";
      if (!allowed) {
        issues.push({
          kind: "malformed",
          key: "EXPO_PUBLIC_SUPABASE_URL",
          reason: `Dev variant "${variant}" cannot point to Supabase host "${host}". Expected dev or local Supabase host.`,
        });
      }
    }
  }

  if (input.authRedirectUri) {
    if (variant === "production") {
      if (
        !input.authRedirectUri.startsWith("mizyun://") ||
        input.authRedirectUri.startsWith("mizyun-dev://")
      ) {
        issues.push({
          kind: "malformed",
          key: "EXPO_PUBLIC_AUTH_REDIRECT_URI",
          reason: `Production variant cannot use redirect scheme "${input.authRedirectUri}". Expected scheme "mizyun://".`,
        });
      }
    } else {
      if (!input.authRedirectUri.startsWith("mizyun-dev://")) {
        issues.push({
          kind: "malformed",
          key: "EXPO_PUBLIC_AUTH_REDIRECT_URI",
          reason: `Dev variant cannot use redirect scheme "${input.authRedirectUri}". Expected scheme "mizyun-dev://".`,
        });
      }
    }
  }

  if (issues.length > 0) {
    return err(issues);
  }

  const baseIdentity = BUILD_IDENTITIES[variant];
  return ok({
    ...baseIdentity,
    profile,
  });
};
