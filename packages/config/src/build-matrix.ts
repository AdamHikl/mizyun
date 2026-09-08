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
    iosBundleIdentifier: "com.mizyun.dev",
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

  // 4. Endpoint Host & Redirect URI Conflict Checks
  if (input.apiUrl) {
    const host = extractHostname(input.apiUrl);
    if (host) {
      if (variant === "dev" && PROD_API_HOSTS.has(host)) {
        issues.push({
          kind: "malformed",
          key: "EXPO_PUBLIC_API_URL",
          reason: `Dev variant "${variant}" cannot point to Production API host "${host}".`,
        });
      }
      if (
        variant === "production" &&
        (DEV_API_HOSTS.has(host) ||
          host === "localhost" ||
          host === "127.0.0.1" ||
          host === "10.0.2.2")
      ) {
        issues.push({
          kind: "malformed",
          key: "EXPO_PUBLIC_API_URL",
          reason: `Production variant cannot point to Dev or local API host "${host}".`,
        });
      }
    }
  }

  if (input.supabaseUrl) {
    const host = extractHostname(input.supabaseUrl);
    if (host) {
      if (variant === "dev" && PROD_SUPABASE_HOSTS.has(host)) {
        issues.push({
          kind: "malformed",
          key: "EXPO_PUBLIC_SUPABASE_URL",
          reason: `Dev variant "${variant}" cannot point to Production Supabase host "${host}".`,
        });
      }
      if (
        variant === "production" &&
        (DEV_SUPABASE_HOSTS.has(host) ||
          host === "localhost" ||
          host === "127.0.0.1" ||
          host === "10.0.2.2")
      ) {
        issues.push({
          kind: "malformed",
          key: "EXPO_PUBLIC_SUPABASE_URL",
          reason: `Production variant cannot point to Dev or local Supabase host "${host}".`,
        });
      }
    }
  }

  if (input.authRedirectUri) {
    if (
      variant === "dev" &&
      input.authRedirectUri.startsWith("mizyun://") &&
      !input.authRedirectUri.startsWith("mizyun-dev://")
    ) {
      issues.push({
        kind: "malformed",
        key: "EXPO_PUBLIC_AUTH_REDIRECT_URI",
        reason: `Dev variant cannot use production redirect scheme "mizyun://". Expected "mizyun-dev://".`,
      });
    }
    if (
      variant === "production" &&
      input.authRedirectUri.startsWith("mizyun-dev://")
    ) {
      issues.push({
        kind: "malformed",
        key: "EXPO_PUBLIC_AUTH_REDIRECT_URI",
        reason: `Production variant cannot use dev redirect scheme "mizyun-dev://". Expected "mizyun://".`,
      });
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
